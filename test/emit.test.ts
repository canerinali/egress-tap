import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.js';
import { claudeDomains, emitClaude, isCovered, missingDomains, readAllowedDomains } from '../src/emit/claude.js';
import { emitCodex } from '../src/emit/codex.js';
import { emitJson } from '../src/emit/json.js';
import { explainRules } from '../src/emit/explain.js';
import { parseJsonl } from '../src/log.js';
import type { HostStat } from '../src/aggregate.js';
import { suggest } from '../src/wildcard.js';

const events = parseJsonl(readFileSync(new URL('./fixtures/sample-session.jsonl', import.meta.url), 'utf8'));
const analysis = analyze(events);
const meta = {
  sessionId: 'sample',
  connections: analysis.connections,
  hosts: analysis.hosts.length,
  excludedAgentHosts: analysis.excludedAgentHosts,
};

const stat = (host: string, hits = 1, ports = [443]): HostStat => ({
  host,
  ports,
  hits,
  bytesUp: 0,
  bytesDown: 0,
  firstTs: '2026-09-27T00:00:00.000Z',
  lastTs: '2026-09-27T00:00:00.000Z',
  kinds: ['connect'],
  errors: 0,
});

describe('claude emitter', () => {
  it('produces a parseable settings.json fragment', () => {
    const out = emitClaude(analysis.rules);
    const parsed = JSON.parse(out) as { sandbox: { network: { allowedDomains: string[] } } };
    expect(parsed.sandbox.network.allowedDomains).toMatchInlineSnapshot(`
      [
        "*.npmjs.org",
        "api.github.com",
        "bar.github.io",
        "baz.github.io",
        "files.pythonhosted.org",
        "foo.github.io",
        "github.com",
        "npmjs.org",
        "pypi.org",
      ]
    `);
  });

  it('never allowlists suspicious or agent hosts', () => {
    const domains = claudeDomains(analysis.rules);
    for (const bad of ['paste.ee', '1.2.3.4', 'api.anthropic.com', 'statsig.anthropic.com']) {
      expect(domains).not.toContain(bad);
    }
    expect(domains.some((d) => d.includes('dnslog'))).toBe(false);
  });

  it('keeps agent hosts with --include-agent-hosts', () => {
    const domains = claudeDomains(analyze(events, { includeAgentHosts: true }).rules);
    expect(domains).toContain('api.anthropic.com');
    expect(domains).toContain('statsig.anthropic.com');
  });

  it('explains every decision on stderr', () => {
    expect(explainRules(analysis, (r) => r.domain)).toMatchInlineSnapshot(`
      "  hits  host                                          rule
          15  registry.npmjs.org                            npmjs.org   (3 hosts: registry.npmjs.org, www.npmjs.org, npmjs.org)
           5  api.github.com                                api.github.com
           4  pypi.org                                      pypi.org
           3  files.pythonhosted.org                        files.pythonhosted.org
           3  github.com                                    github.com
           2  paste.ee                                      OMITTED: suspicious (paste/tunnel service (paste.ee)), review it
           1  1.2.3.4                                       OMITTED: suspicious (direct IP address, no hostname; non-standard port 8080), review it
           1  bar.github.io                                 bar.github.io   (shared hosting, not wildcarded)
           1  baz.github.io                                 baz.github.io   (shared hosting, not wildcarded)
           1  foo.github.io                                 foo.github.io   (shared hosting, not wildcarded)
           1  x9k2m4p7q1w8e5r3t6y0u2i4o.dnslog.example.net  OMITTED: suspicious (random-looking label "x9k2m4p7q1w8e5r3t6y0u2i4o" (25 chars, 4.48 bits/char)), review it
        excluded agent hosts: api.anthropic.com, statsig.anthropic.com (--include-agent-hosts to keep)
        WARNING: this is ONE session. Review every line before allowlisting; see \`egress-tap report\`.
      "
    `);
  });
});

describe('codex emitter', () => {
  it('emits a permission profile with suspicious hosts commented out', () => {
    const out = emitCodex(analysis.rules, meta);
    expect(out).toContain('network_proxy = true');
    expect(out).toContain('"**.npmjs.org" = "allow"');
    expect(out).toMatch(/^# "paste\.ee" = "allow" .*SUSPICIOUS/m);
    expect(out).not.toMatch(/^"paste\.ee"/m);
    expect(out).toMatchInlineSnapshot(`
      "# egress-tap: generated from session sample (60 connections, 15 hosts)
      # Format: Codex permission profiles, https://learn.chatgpt.com/docs/permissions (verified 2026-09-27).
      # Requires a Codex version with permission profiles; legacy network_access=true has no domain allowlist.
      # Excluded agent hosts: api.anthropic.com, statsig.anthropic.com (--include-agent-hosts to keep)
      default_permissions = "egress-tap"

      [features]
      network_proxy = true

      [permissions.egress-tap]
      extends = ":workspace"

      [permissions.egress-tap.network]
      enabled = true

      [permissions.egress-tap.network.domains]
      "**.npmjs.org" = "allow"                                    # 15 hits: registry.npmjs.org, www.npmjs.org, npmjs.org
      "api.github.com" = "allow"                                  # 5 hits
      "bar.github.io" = "allow"                                   # 1 hit (shared hosting: not wildcarded)
      "baz.github.io" = "allow"                                   # 1 hit (shared hosting: not wildcarded)
      "files.pythonhosted.org" = "allow"                          # 3 hits
      "foo.github.io" = "allow"                                   # 1 hit (shared hosting: not wildcarded)
      "github.com" = "allow"                                      # 3 hits
      "pypi.org" = "allow"                                        # 4 hits
      # "1.2.3.4" = "allow"                                       # SUSPICIOUS: direct IP address, no hostname; non-standard port 8080, 1 hit, review before enabling
      # "paste.ee" = "allow"                                      # SUSPICIOUS: paste/tunnel service (paste.ee), 2 hits, review before enabling
      # "x9k2m4p7q1w8e5r3t6y0u2i4o.dnslog.example.net" = "allow"  # SUSPICIOUS: random-looking label "x9k2m4p7q1w8e5r3t6y0u2i4o" (25 chars, 4.48 bits/char), 1 hit, review before enabling
      "
    `);
  });

  it('escapes hostile hostnames so they cannot inject TOML lines', () => {
    const rules = suggest([stat('evil.com"\n[features]\nx = "1', 3)]);
    const out = emitCodex(rules, { ...meta, excludedAgentHosts: [] });
    expect(out).not.toMatch(/^\[features\]\nx = /m);
    expect(out.split('\n').filter((l) => l.startsWith('[features]'))).toHaveLength(1);
  });
});

describe('json emitter', () => {
  it('dumps every host with flags and rules', () => {
    const doc = JSON.parse(emitJson('sample', analysis)) as {
      session: string;
      connections: number;
      hosts: { host: string; hits: number; suspicious: boolean; agent: boolean; rule: string | null }[];
      rules: unknown[];
    };
    expect(doc.session).toBe('sample');
    expect(doc.connections).toBe(60);
    expect(doc.hosts).toHaveLength(15);
    expect(doc.hosts.find((h) => h.host === 'www.npmjs.org')).toMatchObject({ hits: 2, rule: '**.npmjs.org' });
    expect(doc.hosts.find((h) => h.host === 'paste.ee')).toMatchObject({ suspicious: true });
    expect(doc.hosts.find((h) => h.host === 'api.anthropic.com')).toMatchObject({ agent: true, rule: null });
    const { version: _v, ...stable } = JSON.parse(emitJson('sample', analysis)) as Record<string, unknown>;
    expect(stable).toMatchSnapshot();
  });
});

describe('wildcard rules', () => {
  it('wildcards a base once the threshold is met, including the apex', () => {
    const rules = suggest([stat('a.example.com'), stat('b.example.com'), stat('example.com')]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ type: 'wildcard', domain: 'example.com', apexSeen: true, hits: 3 });
    expect(claudeDomains(rules)).toEqual(['*.example.com', 'example.com']);
  });

  it('stays exact below the threshold and honors --wildcard-min', () => {
    const two = [stat('a.example.com'), stat('b.example.com')];
    expect(suggest(two).every((r) => r.type === 'exact')).toBe(true);
    expect(suggest(two, { min: 2 })[0]).toMatchObject({ type: 'wildcard', apexSeen: false });
    expect(claudeDomains(suggest(two, { min: 2 }))).toEqual(['*.example.com']);
  });

  it('never produces *.github.io or other shared-hosting wildcards', () => {
    const hosts = ['a', 'b', 'c', 'd'].flatMap((x) => [
      stat(`${x}.github.io`),
      stat(`${x}.vercel.app`),
      stat(`${x}.s3.amazonaws.com`),
    ]);
    const domains = claudeDomains(suggest(hosts, { min: 2 }));
    expect(domains.filter((d) => d.startsWith('*.'))).toEqual([]);
    expect(domains).toContain('a.github.io');
  });

  it('never wildcards multi-tenant storage (e.g. Azure Blob -> *.windows.net)', () => {
    const hosts = ['a', 'b', 'c'].flatMap((x) => [
      stat(`${x}.blob.core.windows.net`),
      stat(`${x}.storage.googleapis.com`),
      stat(`${x}.r2.dev`),
      stat(`${x}.web.app`),
    ]);
    const domains = claudeDomains(suggest(hosts));
    expect(domains.filter((d) => d.startsWith('*.'))).toEqual([]);
    expect(domains).toContain('a.blob.core.windows.net');
  });

  it('refuses to wildcard a base that contains a flagged host', () => {
    const rules = suggest([
      stat('a.example.com'),
      stat('b.example.com'),
      stat('c.example.com'),
      stat('k3j9x2q8v7m1p0z5w4r6t8y2u1i9o3a7.example.com'),
    ]);
    expect(rules.some((r) => r.type === 'wildcard')).toBe(false);
    expect(rules.find((r) => r.domain === 'a.example.com')?.wildcardRefused).toBe('flagged-member');
  });

  it('never wildcards IP literals', () => {
    const rules = suggest([stat('10.0.0.1'), stat('10.0.0.2'), stat('10.0.0.3')], { min: 2 });
    expect(rules.every((r) => r.type === 'exact' && r.flags.length > 0)).toBe(true);
  });
});

describe('--against', () => {
  it('reads allowedDomains from a settings file', () => {
    expect(readAllowedDomains('{"sandbox":{"network":{"allowedDomains":["GitHub.com","*.npmjs.org"]}}}')).toEqual([
      'github.com',
      '*.npmjs.org',
    ]);
    expect(readAllowedDomains('{"permissions":{}}')).toEqual([]);
    expect(() => readAllowedDomains('{nope')).toThrow(/not valid JSON/);
  });

  it('treats *.x as covering subdomains but not the apex', () => {
    expect(isCovered('registry.npmjs.org', ['*.npmjs.org'])).toBe(true);
    expect(isCovered('*.a.npmjs.org', ['*.npmjs.org'])).toBe(true);
    expect(isCovered('npmjs.org', ['*.npmjs.org'])).toBe(false);
    expect(isCovered('evilnpmjs.org', ['*.npmjs.org'])).toBe(false);
    expect(isCovered('pypi.org', ['pypi.org'])).toBe(true);
  });

  it('lists only what is missing', () => {
    expect(missingDomains(analysis.rules, ['*.npmjs.org', 'npmjs.org', 'github.com', 'api.github.com', '*.github.io'])).toEqual([
      'files.pythonhosted.org',
      'pypi.org',
    ]);
  });
});
