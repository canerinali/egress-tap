import net from 'node:net';

/**
 * Two-label public suffixes under which registrable domains have three labels.
 * Deliberately small (no public-suffix-list dependency); covers the common ccTLD cases.
 */
export const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'gen.tr', 'biz.tr', 'info.tr',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'co.za', 'org.za', 'gov.za',
  'co.il', 'org.il', 'ac.il',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.hk', 'org.hk', 'net.hk',
  'com.tw', 'org.tw', 'net.tw',
  'com.sg', 'org.sg', 'net.sg', 'edu.sg',
  'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'org.ar', 'gob.ar',
  'com.my', 'org.my', 'net.my',
  'co.id', 'or.id', 'ac.id',
  'com.ua', 'org.ua', 'net.ua',
  'com.pl', 'org.pl', 'net.pl',
  'com.es', 'org.es',
  'co.th', 'or.th', 'ac.th',
  'com.vn', 'com.ph', 'com.pk', 'com.eg', 'com.sa', 'com.ng', 'co.ke',
]);

/**
 * Base domains where subdomains (or paths) belong to unrelated customers: hosting, object
 * storage, serverless and blog platforms. Wildcarding one of these (e.g. `*.github.io`,
 * `*.windows.net` for Azure Blob Storage) would let a prompt-injected agent exfiltrate to an
 * attacker-owned tenant, so they are never wildcarded; each host stays an exact rule.
 * Matched against `baseDomain()` output, i.e. the last two labels.
 */
export const SHARED_HOSTING = new Set([
  // Code hosting / static sites
  'github.io',
  'githubusercontent.com',
  'gitlab.io',
  'bitbucket.io',
  'codeberg.page',
  'readthedocs.io',
  'gitbook.io',
  'surge.sh',
  'neocities.org',
  'glitch.me',
  // AWS
  'amazonaws.com',
  'cloudfront.net',
  'on.aws',
  'elasticbeanstalk.com',
  'awsapprunner.com',
  // Azure (Blob Storage, App Service, Front Door, API Management, cloud apps)
  'windows.net',
  'azure.com',
  'azurewebsites.net',
  'azureedge.net',
  'azurefd.net',
  'azure-api.net',
  'azurestaticapps.net',
  'azurecontainerapps.io',
  'cloudapp.net',
  'trafficmanager.net',
  // Google Cloud / Firebase
  'appspot.com',
  'googleapis.com',
  'googleusercontent.com',
  'cloudfunctions.net',
  'run.app',
  'web.app',
  'firebaseapp.com',
  'firebaseio.com',
  'firebasestorage.app',
  // Cloudflare
  'workers.dev',
  'pages.dev',
  'r2.dev',
  'cloudflarestorage.com',
  // Other PaaS / storage / CDN tenants
  'herokuapp.com',
  'vercel.app',
  'now.sh',
  'netlify.app',
  'netlify.com',
  'fly.dev',
  'onrender.com',
  'railway.app',
  'deno.dev',
  'replit.app',
  'replit.dev',
  'repl.co',
  'supabase.co',
  'hf.space',
  'digitaloceanspaces.com',
  'ondigitalocean.app',
  'backblazeb2.com',
  'wasabisys.com',
  'fastly.net',
  'fastly-edge.com',
  'akamaized.net',
  'edgekey.net',
  'blogspot.com',
  'wordpress.com',
  'notion.site',
  'webflow.io',
  'myshopify.com',
  'pythonanywhere.com',
]);

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isIpLiteral(host: string): boolean {
  return net.isIP(normalizeHost(host)) !== 0;
}

/** Registrable ("base") domain: `a.b.example.com` -> `example.com`, `a.b.co.uk` -> `b.co.uk`. IPs are returned as-is. */
export function baseDomain(host: string): string {
  const h = normalizeHost(host);
  if (isIpLiteral(h)) return h;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function isSharedHosting(base: string): boolean {
  return SHARED_HOSTING.has(normalizeHost(base));
}

/** True when `host` equals `domain` or is a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  return h === d || h.endsWith('.' + d);
}
