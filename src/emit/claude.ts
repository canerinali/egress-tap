import { normalizeHost } from '../domain.js';
import { isSuspicious, type Rule } from '../wildcard.js';

/** Claude Code patterns for one rule. Wildcards get the bare apex too when it was seen,
 * because it is not documented whether `*.x` matches `x`. */
export function claudePatterns(rule: Rule): string[] {
  if (rule.type === 'exact') return [rule.domain];
  return rule.apexSeen ? [`*.${rule.domain}`, rule.domain] : [`*.${rule.domain}`];
}

/** Sorted, de-duplicated `allowedDomains` for all non-suspicious rules. */
export function claudeDomains(rules: Rule[]): string[] {
  const set = new Set<string>();
  for (const r of rules) if (!isSuspicious(r)) for (const p of claudePatterns(r)) set.add(p);
  return [...set].sort();
}

export function emitClaude(rules: Rule[]): string {
  const doc = { sandbox: { network: { allowedDomains: claudeDomains(rules) } } };
  return JSON.stringify(doc, null, 2) + '\n';
}

/** Extracts `sandbox.network.allowedDomains` from a Claude Code settings.json text. */
export function readAllowedDomains(settingsText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch (err) {
    throw new Error(`settings file is not valid JSON: ${(err as Error).message}`);
  }
  const list = (parsed as { sandbox?: { network?: { allowedDomains?: unknown } } } | null)?.sandbox?.network
    ?.allowedDomains;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('sandbox.network.allowedDomains is not an array');
  return list.filter((d): d is string => typeof d === 'string').map((d) => normalizeHost(d));
}

/**
 * Whether `pattern` is already allowed by `existing`. `*.x` in `existing` covers strict
 * subdomains of `x` and narrower wildcards; it is not assumed to cover the apex `x`.
 */
export function isCovered(pattern: string, existing: string[]): boolean {
  const p = normalizeHost(pattern);
  for (const raw of existing) {
    const e = normalizeHost(raw);
    if (e === p) return true;
    if (e.startsWith('*.')) {
      const suffix = e.slice(1); // ".x"
      const target = p.startsWith('*.') ? p.slice(2) : p;
      if (target.endsWith(suffix)) return true;
    }
  }
  return false;
}

/** Patterns this session needs that `existing` does not already allow. */
export function missingDomains(rules: Rule[], existing: string[]): string[] {
  return claudeDomains(rules).filter((p) => !isCovered(p, existing));
}
