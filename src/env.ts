export const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'] as const;

/**
 * Builds the child's environment: every proxy variable points at our proxy, NO_PROXY is
 * removed (so nothing bypasses observation) and Node's fetch is told to honor the env proxy.
 * Pure: never mutates `parentEnv`.
 */
export function buildChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  port: number,
  sessionId?: string,
  proxyHost = '127.0.0.1',
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parentEnv };
  const url = `http://${proxyHost}:${port}`;
  for (const name of PROXY_VARS) env[name] = url;
  delete env['NO_PROXY'];
  delete env['no_proxy'];
  env['NODE_USE_ENV_PROXY'] = '1';
  if (sessionId) env['EGRESS_TAP_SESSION'] = sessionId;
  return env;
}
