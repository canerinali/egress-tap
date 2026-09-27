import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const client = path.join(root, 'test', 'fixtures', 'client.mjs');
const hasCurl = spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0;

let upstream: http.Server;
let upPort: number;
let dir: string;

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Async on purpose: the upstream server lives in this process and must keep serving. */
function run(args: string[]): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function lines(file: string): Record<string, unknown>[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeAll(async () => {
  if (!existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` first (npm test does)');
  upstream = http.createServer((req, res) => {
    const body = `ok ${req.url}`;
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upPort = (upstream.address() as AddressInfo).port;
  dir = mkdtempSync(path.join(tmpdir(), 'egress-tap-e2e-'));
});

afterAll(async () => {
  await new Promise<void>((r) => upstream.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('egress-tap CLI (end to end)', () => {
  it('prints help listing all commands', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    for (const c of ['emit', 'report', 'ls']) expect(r.stdout).toContain(c);
  });

  it('records a child session, keeps stdout clean and propagates the exit code', async () => {
    const r = await run(['--name', 't1', '--dir', dir, '--', 'node', client, `http://localhost:${upPort}/`]);
    expect(r.code).toBe(7);
    expect(r.stdout).toBe('tunnel:ok /tunnel\nplain:ok /plain\n');
    expect(r.stderr).toContain('egress-tap: proxy 127.0.0.1:');
    expect(r.stderr).toContain('1 host, 2 connections');
    expect(r.stderr).toContain('! 1 suspicious host');

    const events = lines(path.join(dir, 't1.jsonl'));
    expect(events).toHaveLength(2);
    for (const e of events) expect(e).toMatchObject({ host: 'localhost', port: upPort, status: 'ok' });
    expect(events.map((e) => e['kind']).sort()).toEqual(['connect', 'http']);
    expect(events.find((e) => e['kind'] === 'http')).toMatchObject({ method: 'GET' });
    expect(events.find((e) => e['kind'] === 'connect')!['bytesDown']).toBeGreaterThan(0);
  });

  it('emits json for the recorded session', async () => {
    const r = await run(['emit', '--format', 'json', '--dir', dir, 't1']);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout) as { hosts: { host: string; hits: number; flags: { code: string }[] }[] };
    expect(doc.hosts).toHaveLength(1);
    expect(doc.hosts[0]).toMatchObject({ host: 'localhost', hits: 2 });
    expect(doc.hosts[0]!.flags.map((f) => f.code)).toEqual(['odd-port']);
  });

  it('emits claude and codex formats, reports and lists', async () => {
    const claude = await run(['emit', '--dir', dir]);
    expect(JSON.parse(claude.stdout)).toEqual({ sandbox: { network: { allowedDomains: [] } } });
    expect(claude.stderr).toContain('OMITTED: suspicious');
    expect(claude.stderr).toContain('WARNING: this is ONE session');

    const codex = await run(['emit', '--format', 'codex', '--dir', dir, 'latest']);
    expect(codex.stdout).toContain('network_proxy = true');
    expect(codex.stdout).toContain('# "localhost" = "allow"');

    const report = await run(['report', '--format', 'md', '--dir', dir]);
    expect(report.stdout).toContain('`localhost`');
    expect(report.stdout).toContain('Do not blindly allowlist your first session');

    const ls = await run(['ls', '--dir', dir]);
    expect(ls.stdout).toMatch(/^t1\s+\S+\s+2\s+1$/m);
  });

  it('checks --against a settings file', async () => {
    const settings = path.join(dir, 'settings.json');
    writeFileSync(settings, JSON.stringify({ sandbox: { network: { allowedDomains: ['github.com'] } } }));
    const r = await run(['emit', '--include-agent-hosts', '--dir', dir, '--against', settings, 't1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('nothing to add');
    const bad = await run(['emit', '--format', 'codex', '--against', settings, '--dir', dir]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('--against only works with --format claude');
  });

  it('treats everything after -- as the child, even a subcommand name', async () => {
    const r = await run(['--dir', dir, '--name', 'lsname', '--', 'node', '-e', 'process.exit(0)']);
    expect(r.code).toBe(0);
    const r2 = await run(['--dir', dir, '-q', '--', 'ls', path.join(root, 'package.json')]);
    expect(r2.code).toBe(0);
    expect(r2.stdout).toContain('package.json');
    expect(r2.stderr).toBe('');
  });

  it('exits 127 when the command does not exist', async () => {
    const r = await run(['--dir', dir, '--', 'egress-tap-no-such-binary-xyz']);
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('ENOENT');
  });

  it('fails cleanly on an unknown session', async () => {
    const r = await run(['emit', '--dir', dir, 'nope']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('session "nope" not found');
  });

  it.skipIf(!hasCurl)('real tools honor the env proxy (curl)', async () => {
    const r = await run(['--name', 'curl1', '--dir', dir, '--', 'curl', '-s', `http://localhost:${upPort}/c`]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ok /c');
    const events = lines(path.join(dir, 'curl1.jsonl'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'http', host: 'localhost', port: upPort, method: 'GET' });
  });
});
