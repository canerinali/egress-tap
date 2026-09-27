// A stand-in for a coding agent: it makes the kind of requests an agent's tools make during
// "add a dependency and run the tests", plus one DNS-exfil-looking lookup. Uses plain
// fetch(), which honors egress-tap's proxy because egress-tap sets NODE_USE_ENV_PROXY=1.
const targets = [
  ['HEAD', 'https://api.anthropic.com/'], // the agent's own API: excluded from emit by default
  ['GET', 'https://registry.npmjs.org/-/ping'],
  ['HEAD', 'https://registry.npmjs.org/commander'],
  ['HEAD', 'https://www.npmjs.org/'],
  ['HEAD', 'https://npmjs.org/'],
  ['HEAD', 'https://api.github.com/'],
  ['HEAD', 'https://github.com/'],
  ['HEAD', 'https://pypi.org/simple/'],
  // Looks like data smuggled in a subdomain. The name does not resolve, which is fine:
  // egress-tap logs the attempt (status upstream_error) and flags it.
  ['HEAD', 'https://q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3.example.com/'],
];

for (const [method, url] of targets) {
  try {
    const res = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    console.log(`${method} ${url} -> ${res.status}`);
  } catch (err) {
    console.log(`${method} ${url} -> failed (${err.cause?.message ?? err.message})`);
  }
}
