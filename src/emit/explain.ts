import type { Analysis } from '../analyze.js';
import { isSuspicious, type Rule } from '../wildcard.js';

export const ONE_SESSION_WARNING =
  'WARNING: this is ONE session. Review every line before allowlisting; see `egress-tap report`.';

/** Human-readable stderr companion to an emitted allowlist. */
export function explainRules(analysis: Analysis, pattern: (r: Rule) => string): string {
  const rows = analysis.rules.map((r) => {
    let rule: string;
    if (isSuspicious(r)) {
      rule = `OMITTED: suspicious (${r.flags.map((f) => f.reason).join('; ')}), review it`;
    } else {
      rule = pattern(r);
      if (r.type === 'wildcard') rule += `   (${r.covers.length} hosts: ${r.covers.join(', ')})`;
      else if (r.wildcardRefused === 'shared-hosting') rule += '   (shared hosting, not wildcarded)';
      else if (r.wildcardRefused === 'flagged-member') rule += '   (suspicious sibling, not wildcarded)';
    }
    return { hits: String(r.hits), host: r.covers[0] ?? r.domain, rule };
  });
  const hostWidth = Math.max(4, ...rows.map((r) => r.host.length));
  const hitsWidth = Math.max(4, ...rows.map((r) => r.hits.length));
  const lines = [`  ${'hits'.padStart(hitsWidth)}  ${'host'.padEnd(hostWidth)}  rule`];
  for (const r of rows) lines.push(`  ${r.hits.padStart(hitsWidth)}  ${r.host.padEnd(hostWidth)}  ${r.rule}`);
  if (rows.length === 0) lines.push('  (no hosts recorded in this session)');
  if (analysis.excludedAgentHosts.length > 0) {
    lines.push(`  excluded agent hosts: ${analysis.excludedAgentHosts.join(', ')} (--include-agent-hosts to keep)`);
  }
  lines.push(`  ${ONE_SESSION_WARNING}`);
  return lines.join('\n') + '\n';
}
