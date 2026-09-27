import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

export type EventKind = 'connect' | 'http';
export type EventStatus = 'ok' | 'upstream_error' | 'bad_request';

/** One line of the session JSONL: a single proxied connection or request. */
export interface ConnEvent {
  ts: string;
  kind: EventKind;
  host: string;
  port: number;
  method: string;
  bytesUp: number;
  bytesDown: number;
  durationMs: number;
  status: EventStatus;
  error?: string;
}

export interface ProxyOptions {
  onEvent: (event: ConnEvent) => void;
  /** Interface to bind; defaults to 127.0.0.1. */
  host?: string;
  /** Port to bind; defaults to 0 (ephemeral). */
  port?: number;
}

export interface ProxyHandle {
  host: string;
  port: number;
  /** Stops accepting, tears down open tunnels and resolves once every pending event was emitted. */
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Removes hop-by-hop headers (including any named in `Connection`). Exported for tests. */
export function stripHopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const extra = new Set<string>();
  const conn = headers['connection'];
  if (typeof conn === 'string') {
    for (const token of conn.split(',')) {
      const t = token.trim().toLowerCase();
      if (t) extra.add(t);
    }
  }
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase();
    if (value === undefined || HOP_BY_HOP.has(k) || extra.has(k)) continue;
    out[key] = value;
  }
  return out;
}

/** Parses a CONNECT authority (`host:port` or `[v6]:port`). Returns null when malformed. */
export function parseAuthority(authority: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(authority) ?? /^([^:\s/[\]]+):(\d+)$/.exec(authority);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1].toLowerCase(), port };
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code;
  return err instanceof Error ? err.message : String(err);
}

export function startProxy(options: ProxyOptions): Promise<ProxyHandle> {
  const bindHost = options.host ?? '127.0.0.1';
  const sockets = new Set<net.Socket | Duplex>();
  let pending = 0;
  let drained: (() => void) | null = null;

  const track = (s: net.Socket | Duplex): void => {
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
  };

  const safeEmit = (event: ConnEvent): void => {
    try {
      options.onEvent(event);
    } catch {
      // A failing consumer must never take the proxy down.
    }
  };

  /** Registers an in-flight connection; the returned function emits its event exactly once. */
  const begin = (base: Omit<ConnEvent, 'bytesUp' | 'bytesDown' | 'durationMs' | 'status' | 'ts'>) => {
    const start = Date.now();
    const ts = new Date(start).toISOString();
    const counters = { bytesUp: 0, bytesDown: 0 };
    let done = false;
    pending++;
    const finish = (status: EventStatus, error?: string): void => {
      if (done) return;
      done = true;
      const event: ConnEvent = {
        ts,
        ...base,
        bytesUp: counters.bytesUp,
        bytesDown: counters.bytesDown,
        durationMs: Date.now() - start,
        status,
      };
      if (error) event.error = error;
      safeEmit(event);
      pending--;
      if (pending === 0 && drained) drained();
    };
    return { counters, finish };
  };

  const server = http.createServer();

  server.on('connection', (socket: net.Socket) => {
    track(socket);
    socket.on('error', () => {});
  });

  server.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  // Plain HTTP: the client sends an absolute URL (`GET http://host/path`).
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    req.on('error', () => {});
    res.on('error', () => {});
    let target: URL | null = null;
    try {
      target = req.url && /^https?:\/\//i.test(req.url) ? new URL(req.url) : null;
    } catch {
      target = null;
    }
    if (!target || !target.hostname) {
      const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
      const parsed = hostHeader ? parseAuthority(hostHeader.includes(':') ? hostHeader : `${hostHeader}:80`) : null;
      if (parsed) {
        const { finish } = begin({ kind: 'http', host: parsed.host, port: parsed.port, method: req.method ?? 'GET' });
        finish('bad_request', 'not a proxy request (relative URL)');
      }
      res.writeHead(400, { 'content-type': 'text/plain', connection: 'close' });
      res.end('egress-tap: expected an absolute-URL proxy request or CONNECT\n');
      return;
    }

    const isHttps = target.protocol === 'https:';
    const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;
    const { counters, finish } = begin({ kind: 'http', host, port, method: req.method ?? 'GET' });

    const upstreamReq = (isHttps ? https : http).request({
      host,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: stripHopByHop(req.headers),
      agent: false,
    });

    upstreamReq.on('socket', (s) => track(s));

    upstreamReq.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, stripHopByHop(upstreamRes.headers));
      upstreamRes.on('data', (chunk: Buffer) => {
        counters.bytesDown += chunk.length;
      });
      upstreamRes.on('error', (err) => {
        res.destroy();
        finish('upstream_error', errMessage(err));
      });
      upstreamRes.on('end', () => finish('ok'));
      upstreamRes.pipe(res);
    });

    upstreamReq.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain', connection: 'close' });
        res.end(`egress-tap: upstream error: ${errMessage(err)}\n`);
      } else {
        res.destroy();
      }
      finish('upstream_error', errMessage(err));
    });

    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy();
      finish('ok');
    });

    req.on('data', (chunk: Buffer) => {
      counters.bytesUp += chunk.length;
    });
    req.pipe(upstreamReq);
  });

  // HTTPS and anything else tunnelled: `CONNECT host:port`.
  server.on('connect', (req: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    track(clientSocket);
    clientSocket.on('error', () => {});
    const authority = parseAuthority(req.url ?? '');
    if (!authority) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const { counters, finish } = begin({ kind: 'connect', host: authority.host, port: authority.port, method: 'CONNECT' });
    let established = false;
    const upstream = net.connect({ host: authority.host, port: authority.port });
    track(upstream);

    const teardown = (): void => {
      upstream.destroy();
      clientSocket.destroy();
    };

    upstream.once('connect', () => {
      established = true;
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        counters.bytesUp += head.length;
        upstream.write(head);
      }
      clientSocket.on('data', (chunk: Buffer) => {
        counters.bytesUp += chunk.length;
      });
      upstream.on('data', (chunk: Buffer) => {
        counters.bytesDown += chunk.length;
      });
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    upstream.on('error', (err) => {
      if (!established) {
        if (clientSocket.writable) {
          clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        }
        finish('upstream_error', errMessage(err));
      }
      teardown();
    });

    upstream.on('close', () => {
      if (established) clientSocket.end();
      finish(established ? 'ok' : 'upstream_error');
    });
    clientSocket.on('close', () => {
      teardown();
      if (established) finish('ok');
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, bindHost, () => {
      server.off('error', reject);
      const addr = server.address() as AddressInfo;
      const handle: ProxyHandle = {
        host: bindHost,
        port: addr.port,
        close: () =>
          new Promise<void>((done) => {
            let serverClosed = false;
            const maybeDone = (): void => {
              if (serverClosed && pending === 0) done();
            };
            drained = maybeDone;
            server.close(() => {
              serverClosed = true;
              maybeDone();
            });
            for (const s of sockets) s.destroy();
            server.closeAllConnections();
          }),
      };
      resolve(handle);
    });
  });
}
