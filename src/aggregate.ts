import { normalizeHost } from './domain.js';
import type { ConnEvent, EventKind } from './proxy.js';

export interface HostStat {
  host: string;
  ports: number[];
  hits: number;
  bytesUp: number;
  bytesDown: number;
  firstTs: string;
  lastTs: string;
  kinds: EventKind[];
  errors: number;
}

/** Folds connection events into one row per host, sorted by hits (desc) then host name. */
export function aggregate(events: ConnEvent[]): HostStat[] {
  const byHost = new Map<string, HostStat & { portSet: Set<number>; kindSet: Set<EventKind> }>();
  for (const e of events) {
    const host = normalizeHost(e.host);
    if (!host) continue;
    let s = byHost.get(host);
    if (!s) {
      s = {
        host,
        ports: [],
        hits: 0,
        bytesUp: 0,
        bytesDown: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        kinds: [],
        errors: 0,
        portSet: new Set(),
        kindSet: new Set(),
      };
      byHost.set(host, s);
    }
    s.hits++;
    s.bytesUp += e.bytesUp;
    s.bytesDown += e.bytesDown;
    if (e.ts < s.firstTs) s.firstTs = e.ts;
    if (e.ts > s.lastTs) s.lastTs = e.ts;
    s.portSet.add(e.port);
    s.kindSet.add(e.kind);
    if (e.status !== 'ok') s.errors++;
  }
  return [...byHost.values()]
    .map(({ portSet, kindSet, ...s }) => ({
      ...s,
      ports: [...portSet].sort((a, b) => a - b),
      kinds: [...kindSet].sort(),
    }))
    .sort((a, b) => b.hits - a.hits || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
}
