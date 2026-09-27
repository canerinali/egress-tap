import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonl, previousHosts } from '../src/log.js';
import { FIRST_SESSION_WARNING, formatBytes, renderReport, type ReportInput } from '../src/report.js';

const fixture = readFileSync(new URL('./fixtures/sample-session.jsonl', import.meta.url), 'utf8');
const events = parseJsonl(fixture);

const first: ReportInput = {
  sessionId: 'sample',
  path: '.egress-tap/sample.jsonl',
  events,
  previousHosts: new Set(),
  previousSessions: 0,
};

describe.each(['text', 'md'] as const)('report (%s)', (format) => {
  const out = renderReport(first, format);

  it('lists flagged hosts with their reasons', () => {
    expect(out).toContain('paste.ee');
    expect(out).toContain('paste/tunnel service');
    expect(out).toContain('1.2.3.4');
    expect(out).toContain('ip-literal');
    expect(out).toContain('x9k2m4p7q1w8e5r3t6y0u2i4o.dnslog.example.net');
    expect(out).toContain('high-entropy');
  });

  it('includes the fixed warning block and first-session notice', () => {
    expect(out).toContain(FIRST_SESSION_WARNING);
    expect(out).toContain("no earlier session to compare against");
  });

  it('shows the agent hosts and session meta', () => {
    expect(out).toContain('api.anthropic.com');
    expect(out).toMatch(/60 \(1 failed\)/);
  });

  it('marks hosts that are new compared to previous sessions', () => {
    const compared = renderReport(
      { ...first, previousHosts: new Set(['registry.npmjs.org', 'api.anthropic.com']), previousSessions: 2 },
      format,
    );
    expect(compared).toContain('2 previous sessions');
    expect(compared).toMatch(/New since previous sessions \(13\)/);
    expect(compared).toContain('NEW');
    expect(compared).toContain('seen');
    expect(compared).not.toContain("no earlier session to compare against");
    expect(compared).toContain(FIRST_SESSION_WARNING);
  });
});

describe('report details', () => {
  it('renders a markdown table with top hosts', () => {
    const md = renderReport(first, 'md');
    expect(md).toContain('| Hits | Host | Ports | Down | Up | First seen | Notes |');
    expect(md).toContain('| 12 | `registry.npmjs.org` | 443 |');
    expect(md.match(/^\| \d+ \| `/gm)).toHaveLength(10);
  });

  it('handles an empty session', () => {
    const out = renderReport({ ...first, events: [] }, 'text');
    expect(out).toContain('no connections');
    expect(out).toContain(FIRST_SESSION_WARNING);
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('collects hosts only from older sessions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'egress-tap-rep-'));
    try {
      const line = (host: string) => JSON.stringify({ ...events[0], host }) + '\n';
      writeFileSync(path.join(dir, 'old.jsonl'), line('old.example.com'));
      writeFileSync(path.join(dir, 'cur.jsonl'), line('cur.example.com'));
      writeFileSync(path.join(dir, 'new.jsonl'), line('new.example.com'));
      utimesSync(path.join(dir, 'old.jsonl'), new Date(1000), new Date(1000));
      utimesSync(path.join(dir, 'cur.jsonl'), new Date(2000), new Date(2000));
      utimesSync(path.join(dir, 'new.jsonl'), new Date(3000), new Date(3000));
      const prev = previousHosts(dir, 'cur');
      expect(prev.sessions).toBe(1);
      expect([...prev.hosts]).toEqual(['old.example.com']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
