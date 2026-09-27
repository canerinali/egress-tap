import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAuthority, startProxy, stripHopByHop, type ConnEvent, type ProxyHandle } from '../src/proxy.js';

const BODY = 'hello from upstream';

let upstream: http.Server;
let upPort: number;
let proxy: ProxyHandle;
let events: ConnEvent[];

beforeEach(async () => {
  upstream = http.createServer((req, res) => {
    let received = 0;
    req.on('data', (c: Buffer) => (received += c.length));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain', 'x-path': req.url ?? '', 'x-received': String(received) });
      res.end(BODY);
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upPort = (upstream.address() as AddressInfo).port;
  events = [];
  proxy = await startProxy({ onEvent: (e) => events.push(e) });
});

afterEach(async () => {
  await proxy.close();
  await new Promise<void>((r) => upstream.close(() => r()));
});

function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - start > ms) return reject(new Error('timed out waiting for event'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('proxy', () => {
  it('forwards absolute-URL plain HTTP and emits an http event', async () => {
    const { status, body, headers } = await new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>(
      (resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: proxy.port,
            method: 'POST',
            path: `http://localhost:${upPort}/x?y=1`,
            headers: { 'proxy-connection': 'keep-alive' },
          },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (c: string) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
          },
        );
        req.on('error', reject);
        req.end('abcd');
      },
    );
    expect(status).toBe(200);
    expect(body).toBe(BODY);
    expect(headers['x-path']).toBe('/x?y=1');
    expect(headers['x-received']).toBe('4');
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({
      kind: 'http',
      host: 'localhost',
      port: upPort,
      method: 'POST',
      status: 'ok',
      bytesUp: 4,
      bytesDown: BODY.length,
    });
  });

  it('tunnels CONNECT and counts bytes both ways', async () => {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `localhost:${upPort}` });
      req.on('connect', (res, sock) => {
        expect(res.statusCode).toBe(200);
        resolve(sock);
      });
      req.on('error', reject);
      req.end();
    });
    const request = `GET /tunnel HTTP/1.1\r\nHost: localhost:${upPort}\r\nConnection: close\r\n\r\n`;
    const raw = await new Promise<string>((resolve, reject) => {
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (c: string) => (data += c));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
      socket.write(request);
    });
    socket.destroy();
    expect(raw).toContain('200 OK');
    expect(raw).toContain(BODY);
    await waitFor(() => events.length === 1);
    const ev = events[0]!;
    expect(ev).toMatchObject({ kind: 'connect', host: 'localhost', port: upPort, method: 'CONNECT', status: 'ok' });
    expect(ev.bytesUp).toBe(Buffer.byteLength(request));
    expect(ev.bytesDown).toBe(Buffer.byteLength(raw));
  });

  it('answers 502 and logs upstream_error when CONNECT target is closed', async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `127.0.0.1:${deadPort}` });
      req.on('connect', (res, sock) => {
        sock.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(502);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: 'connect', host: '127.0.0.1', port: deadPort, status: 'upstream_error' });
    expect(events[0]!.error).toBe('ECONNREFUSED');
  });

  it('answers 502 for plain HTTP to a closed port', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, path: 'http://127.0.0.1:1/' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(502);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: 'http', status: 'upstream_error', port: 1 });
  });

  it('rejects relative-URL requests with 400', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, path: '/' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(400);
  });

  it('close() flushes events of tunnels that are still open', async () => {
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: `localhost:${upPort}` });
      req.on('connect', (_res, s) => resolve(s));
      req.on('error', reject);
      req.end();
    });
    sock.on('error', () => {});
    await proxy.close();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'connect', status: 'ok' });
    proxy = await startProxy({ onEvent: () => {} });
  });
});

describe('helpers', () => {
  it('parses authorities', () => {
    expect(parseAuthority('example.com:443')).toEqual({ host: 'example.com', port: 443 });
    expect(parseAuthority('[::1]:8080')).toEqual({ host: '::1', port: 8080 });
    expect(parseAuthority('Example.COM:80')).toEqual({ host: 'example.com', port: 80 });
    expect(parseAuthority('example.com')).toBeNull();
    expect(parseAuthority('example.com:0')).toBeNull();
    expect(parseAuthority('example.com:70000')).toBeNull();
    expect(parseAuthority('a/b:80')).toBeNull();
  });

  it('strips hop-by-hop headers including Connection-listed ones', () => {
    expect(
      stripHopByHop({
        connection: 'keep-alive, x-secret',
        'x-secret': '1',
        'proxy-authorization': 'Basic abc',
        'transfer-encoding': 'chunked',
        accept: '*/*',
      }),
    ).toEqual({ accept: '*/*' });
  });
});
