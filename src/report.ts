import { analyze, type AnnotatedHost } from './analyze.js';
import type { ConnEvent } from './proxy.js';

export const FIRST_SESSION_WARNING =
  'Do not blindly allowlist your first session: an agent that was already prompt-injected will have produced its exfil host here too.';

export type ReportFormat = 'text' | 'md';

export interface ReportInput {
  sessionId: string;
  path: string;
  events: ConnEvent[];
  /** Hosts seen in the *other* sessions of the same directory. */
  previousHosts: Set<string>;
  previousSessions: number;
}

const TOP_N = 10;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

interface Model {
  input: ReportInput;
  hosts: AnnotatedHost[];
  top: AnnotatedHost[];
  suspicious: AnnotatedHost[];
  agent: AnnotatedHost[];
  newHosts: AnnotatedHost[];
  errors: number;
  firstTs: string | null;
  lastTs: string | null;
  compared: boolean;
}

function buildModel(input: ReportInput): Model {
  const { hosts } = analyze(input.events, { includeAgentHosts: true });
  const ts = input.events.map((e) => e.ts).sort();
  const compared = input.previousSessions > 0;
  return {
    input,
    hosts,
    top: hosts.slice(0, TOP_N),
    suspicious: hosts.filter((h) => h.flags.length > 0),
    agent: hosts.filter((h) => h.agent),
    newHosts: compared ? hosts.filter((h) => !input.previousHosts.has(h.host)) : [],
    errors: input.events.filter((e) => e.status !== 'ok').length,
    firstTs: ts[0] ?? null,
    lastTs: ts[ts.length - 1] ?? null,
    compared,
  };
}

function newness(m: Model, h: AnnotatedHost): string {
  if (!m.compared) return '-';
  return m.input.previousHosts.has(h.host) ? 'seen' : 'NEW';
}

function notes(h: AnnotatedHost): string {
  const parts: string[] = [];
  if (h.agent) parts.push('agent');
  if (h.flags.length > 0) parts.push(`suspicious: ${h.flags.map((f) => f.code).join(', ')}`);
  if (h.errors > 0) parts.push(`${h.errors} error${h.errors === 1 ? '' : 's'}`);
  return parts.join('; ');
}

function windowText(m: Model): string {
  if (!m.firstTs || !m.lastTs) return 'no connections';
  const secs = Math.max(0, (Date.parse(m.lastTs) - Date.parse(m.firstTs)) / 1000);
  return `${m.firstTs} -> ${m.lastTs} (${secs.toFixed(1)}s)`;
}

function comparedText(m: Model): string {
  return m.compared
    ? `${m.input.previousSessions} previous session${m.input.previousSessions === 1 ? '' : 's'} in the same directory`
    : 'nothing (this is the only session in the directory)';
}

function pad(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) =>
    r
      .map((c, i) => (i === 0 ? c.padStart(widths[i]!) : i === r.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd(),
  );
}

function renderText(m: Model): string {
  const out: string[] = [];
  const i = m.input;
  out.push(`egress-tap report · session ${i.sessionId}`);
  out.push(`  file:        ${i.path}`);
  out.push(`  window:      ${windowText(m)}`);
  out.push(
    `  connections: ${i.events.length} (${m.errors} failed) · hosts: ${m.hosts.length} · suspicious: ${m.suspicious.length} · agent: ${m.agent.length}`,
  );
  out.push(`  compared to: ${comparedText(m)}`);
  out.push('');
  out.push(`Top ${Math.min(TOP_N, m.hosts.length)} hosts`);
  if (m.top.length === 0) {
    out.push('  (none)');
  } else {
    const rows = [['hits', 'host', 'ports', 'down', 'up', 'first seen', 'notes']];
    for (const h of m.top) {
      rows.push([String(h.hits), h.host, h.ports.join(','), formatBytes(h.bytesDown), formatBytes(h.bytesUp), newness(m, h), notes(h)]);
    }
    for (const line of pad(rows)) out.push(`  ${line}`);
  }
  out.push('');
  out.push(`Suspicious hosts (${m.suspicious.length})`);
  if (m.suspicious.length === 0) out.push('  (none flagged by the heuristics; that is not proof of safety)');
  for (const h of m.suspicious) {
    out.push(`  ! ${h.host}  [${h.hits} hit${h.hits === 1 ? '' : 's'}, ports ${h.ports.join(',')}]`);
    for (const f of h.flags) out.push(`      ${f.code}: ${f.reason}`);
  }
  if (m.compared) {
    out.push('');
    out.push(`New since previous sessions (${m.newHosts.length})`);
    if (m.newHosts.length === 0) out.push('  (none)');
    for (const h of m.newHosts) out.push(`  + ${h.host}${h.flags.length ? '  (suspicious)' : ''}`);
  }
  if (m.agent.length > 0) {
    out.push('');
    out.push('Agent hosts (left out of `egress-tap emit` by default)');
    for (const h of m.agent) out.push(`  ${h.host}  [${h.hits} hit${h.hits === 1 ? '' : 's'}]`);
  }
  out.push('');
  if (!m.compared) out.push('FIRST SESSION: there is no earlier session to compare against.');
  out.push(`WARNING: ${FIRST_SESSION_WARNING}`);
  return out.join('\n') + '\n';
}

/** Escapes a value for a Markdown table cell and renders it as inline code. */
function mdCode(s: string): string {
  const clean = s.replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
  return `\`${clean}\``;
}

function mdText(s: string): string {
  return s.replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|');
}

function renderMd(m: Model): string {
  const i = m.input;
  const out: string[] = [];
  out.push(`## egress-tap report: \`${mdText(i.sessionId)}\``);
  out.push('');
  out.push('| | |');
  out.push('|---|---|');
  out.push(`| Session file | ${mdCode(i.path)} |`);
  out.push(`| Window | ${mdText(windowText(m))} |`);
  out.push(`| Connections | ${i.events.length} (${m.errors} failed) |`);
  out.push(`| Hosts | ${m.hosts.length} (${m.suspicious.length} suspicious, ${m.agent.length} agent) |`);
  out.push(`| Compared to | ${mdText(comparedText(m))} |`);
  out.push('');
  out.push(`### Top ${Math.min(TOP_N, m.hosts.length)} hosts`);
  out.push('');
  if (m.top.length === 0) {
    out.push('_No connections recorded._');
  } else {
    out.push('| Hits | Host | Ports | Down | Up | First seen | Notes |');
    out.push('|---:|---|---|---:|---:|---|---|');
    for (const h of m.top) {
      out.push(
        `| ${h.hits} | ${mdCode(h.host)} | ${h.ports.join(', ')} | ${formatBytes(h.bytesDown)} | ${formatBytes(h.bytesUp)} | ${newness(m, h)} | ${mdText(notes(h))} |`,
      );
    }
  }
  out.push('');
  out.push(`### Suspicious hosts (${m.suspicious.length})`);
  out.push('');
  if (m.suspicious.length === 0) out.push('_None flagged by the heuristics; that is not proof of safety._');
  for (const h of m.suspicious) {
    out.push(`- ${mdCode(h.host)} (${h.hits} hit${h.hits === 1 ? '' : 's'}, ports ${h.ports.join(', ')})`);
    for (const f of h.flags) out.push(`  - **${f.code}**: ${mdText(f.reason)}`);
  }
  if (m.compared) {
    out.push('');
    out.push(`### New since previous sessions (${m.newHosts.length})`);
    out.push('');
    if (m.newHosts.length === 0) out.push('_None._');
    for (const h of m.newHosts) out.push(`- ${mdCode(h.host)}${h.flags.length ? ' (suspicious)' : ''}`);
  }
  if (m.agent.length > 0) {
    out.push('');
    out.push('### Agent hosts');
    out.push('');
    out.push('Left out of `egress-tap emit` by default (Claude Code\'s allowlist governs sandboxed commands, not the agent\'s own API calls).');
    out.push('');
    for (const h of m.agent) out.push(`- ${mdCode(h.host)} (${h.hits} hit${h.hits === 1 ? '' : 's'})`);
  }
  out.push('');
  if (!m.compared) out.push('> **First session:** there is no earlier session to compare against.');
  if (!m.compared) out.push('>');
  out.push(`> **Warning:** ${FIRST_SESSION_WARNING}`);
  return out.join('\n') + '\n';
}

export function renderReport(input: ReportInput, format: ReportFormat = 'text'): string {
  const m = buildModel(input);
  return format === 'md' ? renderMd(m) : renderText(m);
}
