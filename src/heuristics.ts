import { hostMatches, isIpLiteral, normalizeHost } from './domain.js';

export type FlagCode = 'high-entropy' | 'ip-literal' | 'paste-tunnel' | 'odd-port' | 'invalid-host';

export interface Flag {
  code: FlagCode;
  reason: string;
}

/** Paste bins, tunnels and request catchers: classic exfiltration endpoints. Suffix-matched. */
export const PASTE_TUNNEL_DOMAINS = [
  'pastebin.com',
  'paste.ee',
  'hastebin.com',
  'termbin.com',
  'transfer.sh',
  'ngrok.io',
  'ngrok-free.app',
  'ngrok.app',
  'trycloudflare.com',
  'loca.lt',
  'localtunnel.me',
  'serveo.net',
  'webhook.site',
  'requestbin.net',
  'pipedream.net',
  'interact.sh',
  'oast.fun',
  'oast.pro',
  'oast.live',
  'burpcollaborator.net',
] as const;

export const ENTROPY_MIN_LENGTH = 20;
export const ENTROPY_THRESHOLD = 3.5;
export const NORMAL_PORTS = new Set([80, 443]);

const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62})(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}))*$/;

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Heuristic flags for one host (optionally seen on `ports`). Empty array = nothing suspicious. */
export function flag(host: string, ports: number | number[] = []): Flag[] {
  const h = normalizeHost(host);
  const flags: Flag[] = [];
  const ip = isIpLiteral(h);

  if (ip) {
    flags.push({ code: 'ip-literal', reason: 'direct IP address, no hostname' });
  } else if (!HOSTNAME_RE.test(h)) {
    flags.push({ code: 'invalid-host', reason: 'not a valid DNS hostname' });
  } else {
    for (const label of h.split('.')) {
      if (label.length < ENTROPY_MIN_LENGTH) continue;
      const e = shannonEntropy(label);
      if (e >= ENTROPY_THRESHOLD) {
        flags.push({
          code: 'high-entropy',
          reason: `random-looking label "${label}" (${label.length} chars, ${e.toFixed(2)} bits/char)`,
        });
        break;
      }
    }
    const paste = PASTE_TUNNEL_DOMAINS.find((d) => hostMatches(h, d));
    if (paste) flags.push({ code: 'paste-tunnel', reason: `paste/tunnel service (${paste})` });
  }

  const odd = [...new Set(Array.isArray(ports) ? ports : [ports])].filter((p) => !NORMAL_PORTS.has(p)).sort((a, b) => a - b);
  if (odd.length > 0) flags.push({ code: 'odd-port', reason: `non-standard port ${odd.join(', ')}` });
  return flags;
}
