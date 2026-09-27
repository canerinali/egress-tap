import { describe, expect, it } from 'vitest';
import { buildChildEnv, PROXY_VARS } from '../src/env.js';

describe('buildChildEnv', () => {
  const parent = {
    PATH: '/usr/bin',
    NO_PROXY: 'localhost,.internal',
    no_proxy: '*',
    HTTPS_PROXY: 'http://corp:3128',
  };

  it('sets all six proxy variables to the local proxy', () => {
    const env = buildChildEnv(parent, 41873);
    expect(PROXY_VARS).toHaveLength(6);
    for (const name of PROXY_VARS) expect(env[name]).toBe('http://127.0.0.1:41873');
  });

  it('removes NO_PROXY in both cases', () => {
    const env = buildChildEnv(parent, 1);
    expect('NO_PROXY' in env).toBe(false);
    expect('no_proxy' in env).toBe(false);
  });

  it('enables Node env-proxy support and tags the session', () => {
    const env = buildChildEnv(parent, 1, 'abc');
    expect(env['NODE_USE_ENV_PROXY']).toBe('1');
    expect(env['EGRESS_TAP_SESSION']).toBe('abc');
    expect(buildChildEnv(parent, 1)['EGRESS_TAP_SESSION']).toBeUndefined();
  });

  it('keeps unrelated variables and does not mutate the parent env', () => {
    const copy = { ...parent };
    const env = buildChildEnv(parent, 1);
    expect(env['PATH']).toBe('/usr/bin');
    expect(parent).toEqual(copy);
  });
});
