// Test client for the e2e suite: talks to the proxy named in the environment by hand with
// node:http (one CONNECT tunnel, one absolute-URL GET), so it behaves the same on every Node.
// Usage: node client.mjs http://localhost:<port>/   -> exits 7 on success, 1 on failure.
import http from 'node:http';

const target = new URL(process.argv[2] ?? '');
const proxyUrl = new URL(process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? '');

function viaConnect() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxyUrl.hostname,
      port: proxyUrl.port,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port}`,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT answered ${res.statusCode}`));
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (c) => (data += c));
      socket.on('end', () => resolve(data.split('\r\n\r\n').slice(1).join('\r\n\r\n')));
      socket.on('error', reject);
      socket.write(`GET /tunnel HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`);
    });
    req.on('error', reject);
    req.end();
  });
}

function viaAbsoluteUrl() {
  const httpProxy = new URL(process.env.HTTP_PROXY ?? '');
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: httpProxy.hostname, port: httpProxy.port, path: new URL('/plain', target).href, agent: false },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

try {
  const tunnelled = await viaConnect();
  const plain = await viaAbsoluteUrl();
  process.stdout.write(`tunnel:${tunnelled}\nplain:${plain}\n`);
  process.exit(7);
} catch (err) {
  process.stderr.write(`client failed: ${err.message}\n`);
  process.exit(1);
}
