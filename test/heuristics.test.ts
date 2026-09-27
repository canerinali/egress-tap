import { describe, expect, it } from 'vitest';
import { flag, shannonEntropy } from '../src/heuristics.js';
import { aggregate } from '../src/aggregate.js';
import type { ConnEvent } from '../src/proxy.js';

const codes = (host: string, ports: number | number[] = 443) => flag(host, ports).map((f) => f.code);

describe('flag', () => {
  it('flags a random 32-char label as high-entropy', () => {
    expect(codes('k3j9x2q8v7m1p0z5w4r6t8y2u1i9o3a7.example.com')).toEqual(['high-entropy']);
    expect(codes('5f4dcc3b5aa765d61d8327deb882cf99.attacker.net')).toEqual(['high-entropy']);
  });

  it('does not flag ordinary hosts', () => {
    expect(codes('registry.npmjs.org')).toEqual([]);
    expect(codes('objects.githubusercontent.com')).toEqual([]);
    expect(codes('localhost', 80)).toEqual([]);
  });

  it('respects the entropy length and threshold edges', () => {
    // 19 distinct chars: too short to be considered at all.
    expect(codes('abcdefghijklmnopqrs.example.com')).toEqual([]);
    // 20 chars, but only two symbols: entropy 1.0.
    expect(codes('abababababababababab.example.com')).toEqual([]);
    // 20 distinct chars: entropy log2(20) = 4.32.
    expect(codes('abcdefghijklmnopqrst.example.com')).toEqual(['high-entropy']);
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBe(2);
  });

  it('flags IP literals', () => {
    expect(codes('1.2.3.4')).toEqual(['ip-literal']);
    expect(codes('::1')).toEqual(['ip-literal']);
  });

  it('flags paste and tunnel services by suffix', () => {
    expect(codes('x.trycloudflare.com')).toEqual(['paste-tunnel']);
    expect(codes('paste.ee')).toEqual(['paste-tunnel']);
    expect(codes('abc.oast.fun')).toEqual(['paste-tunnel']);
    expect(codes('notpastebin.com')).toEqual([]);
  });

  it('flags non-standard ports and invalid hostnames', () => {
    expect(codes('example.com', [443, 8443, 22])).toEqual(['odd-port']);
    expect(flag('example.com', [8443, 22])[0]!.reason).toBe('non-standard port 22, 8443');
    expect(codes('bad host"\n.com')).toEqual(['invalid-host']);
  });
});

describe('aggregate', () => {
  const base: ConnEvent = {
    ts: '2026-09-27T14:00:00.000Z',
    kind: 'connect',
    host: 'a.example.com',
    port: 443,
    method: 'CONNECT',
    bytesUp: 1,
    bytesDown: 2,
    durationMs: 1,
    status: 'ok',
  };

  it('groups by host and sums counters', () => {
    const stats = aggregate([
      base,
      { ...base, ts: '2026-09-27T13:00:00.000Z', host: 'A.example.com', kind: 'http', port: 80, status: 'upstream_error' },
      { ...base, host: 'b.example.com' },
    ]);
    expect(stats).toEqual([
      {
        host: 'a.example.com',
        ports: [80, 443],
        hits: 2,
        bytesUp: 2,
        bytesDown: 4,
        firstTs: '2026-09-27T13:00:00.000Z',
        lastTs: '2026-09-27T14:00:00.000Z',
        kinds: ['connect', 'http'],
        errors: 1,
      },
      expect.objectContaining({ host: 'b.example.com', hits: 1 }),
    ]);
  });
});
