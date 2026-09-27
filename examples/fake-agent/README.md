# Example: observe a fake agent

`agent.mjs` stands in for a coding agent. It uses plain `fetch()` to hit the hosts an agent
typically touches while adding a dependency (npm registry, GitHub, PyPI), one request to the
agent's own API host, and one request to a random-looking subdomain of the kind used for
DNS-style data exfiltration (it does not resolve, so the proxy answers 502).

```sh
./run.sh
```

What it does:

1. `egress-tap --name demo -- node agent.mjs` records every connection to `.egress-tap/demo.jsonl`.
2. `egress-tap emit --format claude demo` prints the Claude Code `sandbox.network.allowedDomains`
   fragment: `registry.npmjs.org`, `www.npmjs.org` and `npmjs.org` collapse into `*.npmjs.org` + `npmjs.org`,
   `api.anthropic.com` is excluded as agent self-traffic, and the random-looking host is omitted
   with an explanation on stderr.
3. `egress-tap emit --format codex demo` prints the same as a Codex permission profile, with the
   suspicious host commented out.
4. `egress-tap report demo` prints the session report.

The agent needs internet access for its own requests. egress-tap itself makes no network calls
other than forwarding what the child asks for. Requires Node >= 22.21 (for `NODE_USE_ENV_PROXY`)
and a built checkout (`npm install && npm run build` at the repo root; `run.sh` does this if needed).
