import { describe, expect, it } from 'vitest';
import { baseDomain, hostMatches, isIpLiteral, isSharedHosting } from '../src/domain.js';
import { isAgentHost } from '../src/agentHosts.js';

describe('baseDomain', () => {
  it('keeps the last two labels for ordinary TLDs', () => {
    expect(baseDomain('registry.npmjs.org')).toBe('npmjs.org');
    expect(baseDomain('a.b.c.example.com')).toBe('example.com');
    expect(baseDomain('npmjs.org')).toBe('npmjs.org');
    expect(baseDomain('localhost')).toBe('localhost');
  });

  it('keeps three labels under multi-part suffixes', () => {
    expect(baseDomain('a.b.co.uk')).toBe('b.co.uk');
    expect(baseDomain('www.example.com.tr')).toBe('example.com.tr');
    expect(baseDomain('cdn.shop.com.au')).toBe('shop.com.au');
    expect(baseDomain('b.co.uk')).toBe('b.co.uk');
  });

  it('normalizes case and trailing dots, and leaves IPs alone', () => {
    expect(baseDomain('WWW.Example.COM.')).toBe('example.com');
    expect(baseDomain('10.0.0.1')).toBe('10.0.0.1');
    expect(baseDomain('[2001:db8::1]')).toBe('2001:db8::1');
  });
});

describe('isIpLiteral', () => {
  it('detects IPv4 and IPv6, bracketed or not', () => {
    expect(isIpLiteral('1.2.3.4')).toBe(true);
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('2001:db8::dead:beef')).toBe(true);
    expect(isIpLiteral('1.2.3.4.example.com')).toBe(false);
    expect(isIpLiteral('example.com')).toBe(false);
  });
});

describe('matching helpers', () => {
  it('matches apex and subdomains only', () => {
    expect(hostMatches('api.github.com', 'github.com')).toBe(true);
    expect(hostMatches('github.com', 'github.com')).toBe(true);
    expect(hostMatches('evilgithub.com', 'github.com')).toBe(false);
  });

  it('knows shared-hosting bases and agent hosts', () => {
    expect(isSharedHosting('github.io')).toBe(true);
    expect(isSharedHosting('github.com')).toBe(false);
    expect(isAgentHost('api.anthropic.com')).toBe(true);
    expect(isAgentHost('o4504.ingest.sentry.io')).toBe(true);
    expect(isAgentHost('anthropic.com')).toBe(false);
    expect(isAgentHost('github.com')).toBe(false);
  });
});
