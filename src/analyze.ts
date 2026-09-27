import { aggregate, type HostStat } from './aggregate.js';
import { isAgentHost } from './agentHosts.js';
import { flag, type Flag } from './heuristics.js';
import type { ConnEvent } from './proxy.js';
import { suggest, type Rule } from './wildcard.js';

export interface AnnotatedHost extends HostStat {
  flags: Flag[];
  agent: boolean;
}

export interface Analysis {
  connections: number;
  hosts: AnnotatedHost[];
  /** Agent self-traffic hosts left out of `rules`. Empty when agent hosts are included. */
  excludedAgentHosts: string[];
  rules: Rule[];
}

export interface AnalyzeOptions {
  wildcardMin?: number;
  includeAgentHosts?: boolean;
}

export function analyze(events: ConnEvent[], options: AnalyzeOptions = {}): Analysis {
  const stats = aggregate(events);
  const hosts: AnnotatedHost[] = stats.map((s) => ({ ...s, flags: flag(s.host, s.ports), agent: isAgentHost(s.host) }));
  const excluded = options.includeAgentHosts ? [] : hosts.filter((h) => h.agent);
  const excludedSet = new Set(excluded.map((h) => h.host));
  const rules = suggest(
    stats.filter((s) => !excludedSet.has(s.host)),
    options.wildcardMin === undefined ? {} : { min: options.wildcardMin },
  );
  return { connections: events.length, hosts, excludedAgentHosts: excluded.map((h) => h.host), rules };
}
