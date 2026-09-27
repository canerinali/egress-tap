import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession, JsonlWriter, listSessions, makeSessionId, parseJsonl, readSession } from '../src/log.js';
import { exitCodeFor } from '../src/run.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'egress-tap-log-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ev = {
  ts: '2026-09-27T14:03:15.120Z',
  kind: 'connect' as const,
  host: 'registry.npmjs.org',
  port: 443,
  method: 'CONNECT',
  bytesUp: 10,
  bytesDown: 20,
  durationMs: 5,
  status: 'ok' as const,
};

describe('log', () => {
  it('makes filesystem-safe session ids', () => {
    expect(makeSessionId(new Date('2026-09-27T14:03:11.456Z'))).toBe('2026-09-27T14-03-11Z');
  });

  it('creates unique sessions and refuses bad or duplicate names', () => {
    const now = new Date('2026-09-27T14:03:11Z');
    expect(createSession(dir, undefined, now).id).toBe('2026-09-27T14-03-11Z');
    expect(createSession(dir, undefined, now).id).toBe('2026-09-27T14-03-11Z-2');
    expect(createSession(dir, 'mine').id).toBe('mine');
    expect(() => createSession(dir, 'mine')).toThrow(/already exists/);
    expect(() => createSession(dir, '../escape')).toThrow(/invalid session name/);
  });

  it('writes and reads back JSONL, resolving latest by mtime', () => {
    const a = createSession(dir, 'a');
    const b = createSession(dir, 'b');
    new JsonlWriter(a.path).append(ev);
    new JsonlWriter(b.path).append({ ...ev, host: 'pypi.org' });
    utimesSync(a.path, new Date(1000), new Date(1000));
    expect(listSessions(dir).map((s) => s.id)).toEqual(['b', 'a']);
    expect(readSession(dir, 'latest').events[0]!.host).toBe('pypi.org');
    expect(readSession(dir, 'a').events).toEqual([ev]);
    expect(() => readSession(dir, 'nope')).toThrow(/not found/);
    expect(() => readSession(path.join(dir, 'empty'))).toThrow(/no sessions/);
  });

  it('skips malformed lines', () => {
    const text = [JSON.stringify(ev), '{"truncated":', '', '{"host":"x"}', JSON.stringify({ ...ev, port: 80 })].join('\n');
    expect(parseJsonl(text).map((e) => e.port)).toEqual([443, 80]);
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    expect(listSessions(dir)).toEqual([]);
  });

  it('rejects hosts and timestamps the proxy could never have written', () => {
    const bad = [
      { ...ev, host: 'evil\u001b[2K.example.com' }, // terminal escape
      { ...ev, host: 'a\u202eb.example.com' }, // bidi override
      { ...ev, host: 'a b.example.com' },
      { ...ev, host: 'x\u007f.example.com' }, // DEL breaks TOML comments
      { ...ev, host: 'a'.repeat(256) },
      { ...ev, ts: '\u001b]0;pwned\u0007' },
      { ...ev, port: 1.5 },
      { ...ev, port: 70000 },
    ];
    const text = [...bad, ev].map((e) => JSON.stringify(e)).join('\n');
    expect(parseJsonl(text)).toEqual([ev]);
    expect(parseJsonl(JSON.stringify({ ...ev, method: 'GET\u001b[31m' }))[0]!.method).toBe('');
  });

  it('ignores session files whose names it would not have created', () => {
    writeFileSync(path.join(dir, 'bad\u001b[2Kname.jsonl'), JSON.stringify(ev) + '\n');
    writeFileSync(path.join(dir, '.hidden.jsonl'), JSON.stringify(ev) + '\n');
    createSession(dir, 'good');
    expect(listSessions(dir).map((s) => s.id)).toEqual(['good']);
  });

  it.skipIf(process.platform === 'win32')('creates the log dir and files owner-only', () => {
    const sub = path.join(dir, 'fresh');
    const s = createSession(sub, 'perm');
    expect(statSync(sub).mode & 0o777).toBe(0o700);
    expect(statSync(s.path).mode & 0o777).toBe(0o600);
    new JsonlWriter(s.path).append(ev);
    expect(statSync(s.path).mode & 0o777).toBe(0o600);
  });

  it('maps signals to 128+n exit codes', () => {
    expect(exitCodeFor(7, null)).toBe(7);
    expect(exitCodeFor(null, 'SIGTERM')).toBe(143);
    expect(exitCodeFor(null, 'SIGINT')).toBe(130);
  });
});
