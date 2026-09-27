import type { Analysis } from '../analyze.js';
import { VERSION } from '../version.js';
import { isSuspicious } from '../wildcard.js';
import { claudePatterns } from './claude.js';
import { codexPattern } from './codex.js';

/** Full machine-readable dump: every host with stats and flags, plus the derived rules. */
export function emitJson(sessionId: string, analysis: Analysis): string {
  const ruleFor = new Map<string, string>();
  for (const r of analysis.rules) for (const h of r.covers) ruleFor.set(h, codexPattern(r));
  const doc = {
    tool: 'egress-tap',
    version: VERSION,
    session: sessionId,
    connections: analysis.connections,
    hosts: analysis.hosts.map((h) => ({
      host: h.host,
      ports: h.ports,
      hits: h.hits,
      bytesUp: h.bytesUp,
      bytesDown: h.bytesDown,
      errors: h.errors,
      firstTs: h.firstTs,
      lastTs: h.lastTs,
      kinds: h.kinds,
      agent: h.agent,
      suspicious: h.flags.length > 0,
      flags: h.flags,
      rule: ruleFor.get(h.host) ?? null,
    })),
    excludedAgentHosts: analysis.excludedAgentHosts,
    rules: analysis.rules.map((r) => ({
      type: r.type,
      domain: r.domain,
      suspicious: isSuspicious(r),
      claude: isSuspicious(r) ? [] : claudePatterns(r),
      codex: isSuspicious(r) ? null : codexPattern(r),
      covers: r.covers,
      hits: r.hits,
      flags: r.flags,
      ...(r.wildcardRefused ? { wildcardRefused: r.wildcardRefused } : {}),
    })),
  };
  return JSON.stringify(doc, null, 2) + '\n';
}
