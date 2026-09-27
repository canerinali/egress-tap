import { baseDomain, isIpLiteral, isSharedHosting } from './domain.js';
import { flag, type Flag } from './heuristics.js';
import type { HostStat } from './aggregate.js';

export const DEFAULT_WILDCARD_MIN = 3;

export interface Rule {
  /** `exact`: allow `domain` only. `wildcard`: allow subdomains of `domain` (the base). */
  type: 'exact' | 'wildcard';
  domain: string;
  /** Observed hosts this rule accounts for, most hits first. */
  covers: string[];
  hits: number;
  /** For wildcards: whether the bare apex itself was contacted. */
  apexSeen: boolean;
  /** Non-empty means suspicious: never wildcarded, never emitted as an active rule. */
  flags: Flag[];
  /** Why a base that met the threshold was *not* wildcarded. */
  wildcardRefused?: 'shared-hosting' | 'flagged-member';
}

export interface SuggestOptions {
  /** Distinct hosts needed under one base before it becomes a wildcard. */
  min?: number;
}

export function isSuspicious(rule: Rule): boolean {
  return rule.flags.length > 0;
}

function byHitsThenName(a: { hits: number; host?: string; domain?: string }, b: typeof a): number {
  const an = a.host ?? a.domain ?? '';
  const bn = b.host ?? b.domain ?? '';
  return b.hits - a.hits || (an < bn ? -1 : an > bn ? 1 : 0);
}

/**
 * Turns per-host stats into allowlist rules. Hosts are grouped by base domain; a base with
 * at least `min` distinct clean hosts becomes one wildcard rule. IP literals, flagged hosts,
 * shared-hosting bases and bases containing any flagged host are never wildcarded.
 */
export function suggest(stats: HostStat[], options: SuggestOptions = {}): Rule[] {
  const min = options.min ?? DEFAULT_WILDCARD_MIN;
  const rules: Rule[] = [];
  const groups = new Map<string, HostStat[]>();
  const flaggedBases = new Set<string>();

  const exact = (s: HostStat, flags: Flag[], refused?: Rule['wildcardRefused']): Rule => {
    const r: Rule = { type: 'exact', domain: s.host, covers: [s.host], hits: s.hits, apexSeen: false, flags };
    if (refused) r.wildcardRefused = refused;
    return r;
  };

  for (const s of stats) {
    const flags = flag(s.host, s.ports);
    const ip = isIpLiteral(s.host);
    const base = ip ? s.host : baseDomain(s.host);
    if (flags.length > 0) {
      rules.push(exact(s, flags));
      if (!ip) flaggedBases.add(base);
      continue;
    }
    const list = groups.get(base) ?? [];
    list.push(s);
    groups.set(base, list);
  }

  for (const [base, members] of groups) {
    const eligibleShape = base.includes('.') && !isIpLiteral(base);
    if (members.length >= min && eligibleShape) {
      const refused: Rule['wildcardRefused'] = isSharedHosting(base)
        ? 'shared-hosting'
        : flaggedBases.has(base)
          ? 'flagged-member'
          : undefined;
      if (!refused) {
        const sorted = [...members].sort(byHitsThenName);
        rules.push({
          type: 'wildcard',
          domain: base,
          covers: sorted.map((m) => m.host),
          hits: members.reduce((n, m) => n + m.hits, 0),
          apexSeen: members.some((m) => m.host === base),
          flags: [],
        });
        continue;
      }
      for (const m of members) rules.push(exact(m, [], refused));
      continue;
    }
    for (const m of members) rules.push(exact(m, []));
  }

  return rules.sort(byHitsThenName);
}
