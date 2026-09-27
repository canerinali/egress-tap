import { isSuspicious, type Rule } from '../wildcard.js';

export const CODEX_PROFILE = 'egress-tap';
export const CODEX_DOC_URL = 'https://learn.chatgpt.com/docs/permissions';

export interface CodexMeta {
  sessionId: string;
  connections: number;
  hosts: number;
  excludedAgentHosts: string[];
}

/** `**.x` = apex and every descendant; exact hosts stay exact. */
export function codexPattern(rule: Rule): string {
  return rule.type === 'wildcard' ? `**.${rule.domain}` : rule.domain;
}

/** TOML basic-string key. JSON string escapes are a subset of TOML's, so this is safe. */
function tomlKey(s: string): string {
  return JSON.stringify(s);
}

/** Keeps generated comments on one line whatever ends up in a hostname. */
function commentSafe(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, '?');
}

function describe(rule: Rule): string {
  const hits = `${rule.hits} hit${rule.hits === 1 ? '' : 's'}`;
  if (isSuspicious(rule)) {
    return `SUSPICIOUS: ${rule.flags.map((f) => f.reason).join('; ')}, ${hits}, review before enabling`;
  }
  if (rule.type === 'wildcard') return `${hits}: ${rule.covers.join(', ')}`;
  if (rule.wildcardRefused === 'shared-hosting') return `${hits} (shared hosting: not wildcarded)`;
  if (rule.wildcardRefused === 'flagged-member') return `${hits} (a sibling host is suspicious: not wildcarded)`;
  return hits;
}

export function emitCodex(rules: Rule[], meta: CodexMeta): string {
  const active = rules.filter((r) => !isSuspicious(r)).sort((a, b) => cmp(codexPattern(a), codexPattern(b)));
  const suspicious = rules.filter(isSuspicious).sort((a, b) => cmp(codexPattern(a), codexPattern(b)));
  const entries = [
    ...active.map((r) => ({ line: `${tomlKey(codexPattern(r))} = "allow"`, note: describe(r) })),
    ...suspicious.map((r) => ({ line: `# ${tomlKey(codexPattern(r))} = "allow"`, note: describe(r) })),
  ];
  const width = Math.max(0, ...entries.map((e) => e.line.length));

  const out = [
    `# egress-tap: generated from session ${commentSafe(meta.sessionId)} (${meta.connections} connections, ${meta.hosts} hosts)`,
    `# Format: Codex permission profiles, ${CODEX_DOC_URL} (verified 2026-09-27).`,
    '# Requires a Codex version with permission profiles; legacy network_access=true has no domain allowlist.',
  ];
  if (meta.excludedAgentHosts.length > 0) {
    out.push(`# Excluded agent hosts: ${meta.excludedAgentHosts.map(commentSafe).join(', ')} (--include-agent-hosts to keep)`);
  }
  out.push(
    `default_permissions = ${tomlKey(CODEX_PROFILE)}`,
    '',
    '[features]',
    'network_proxy = true',
    '',
    `[permissions.${CODEX_PROFILE}]`,
    'extends = ":workspace"',
    '',
    `[permissions.${CODEX_PROFILE}.network]`,
    'enabled = true',
    '',
    `[permissions.${CODEX_PROFILE}.network.domains]`,
  );
  for (const e of entries) out.push(`${e.line.padEnd(width)}  # ${commentSafe(e.note)}`);
  return out.join('\n') + '\n';
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
