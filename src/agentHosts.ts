import { hostMatches } from './domain.js';

/**
 * Hosts the coding agents themselves talk to (model API, telemetry, error reporting).
 * Claude Code's `sandbox.network.allowedDomains` governs sandboxed Bash commands, not the
 * agent's own API traffic, so these are left out of emitted allowlists by default.
 * Matching includes subdomains (e.g. `o123.ingest.sentry.io`).
 */
export const AGENT_HOSTS = [
  'api.anthropic.com',
  'statsig.anthropic.com',
  'sentry.io',
  'api.openai.com',
  'chatgpt.com',
  'ab.chatgpt.com',
] as const;

export function isAgentHost(host: string): boolean {
  return AGENT_HOSTS.some((d) => hostMatches(host, d));
}
