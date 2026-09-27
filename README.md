# egress-tap: record every host your AI coding agent contacts, then emit a least-privilege Claude Code / Codex network allowlist.
Install: `npm install -g egress-tap` (or run it with `npx egress-tap`, Node >= 22)\
Usage: `npx egress-tap -- claude -p "add a test and run npm install" && npx egress-tap emit --format claude`

<!-- badges -->

Run your coding agent once behind egress-tap in observe mode. It sets `HTTP(S)_PROXY` for the
agent, forwards everything unchanged through a local proxy, and logs one line per connection
(`host:port`, bytes, duration). Afterwards it turns that log into the allowlist the agent
actually needed, in Claude Code `settings.json` or Codex `config.toml` form, and calls out the
hosts that look like exfiltration before you lock anything in.

## Quickstart

```sh
npx egress-tap -- claude -p "add a test and run npm install"   # 1. observe (sandbox off, see below)
npx egress-tap report                                          # 2. read what happened
npx egress-tap emit --format claude                            # 3. paste into .claude/settings.json
```

## Features

- **Observe, never block.** A plain HTTP proxy on `127.0.0.1:<random port>`: `CONNECT` tunnels for
  HTTPS (no TLS interception, no CA to install) and absolute-URL forwarding for plain HTTP.
  Every request is allowed and forwarded; the child's exit code becomes egress-tap's exit code.
- **Session log** in `.egress-tap/<session>.jsonl`, one JSON line per connection:
  `{"ts":"…","kind":"connect","host":"registry.npmjs.org","port":443,"method":"CONNECT","bytesUp":1830,"bytesDown":48211,"durationMs":412,"status":"ok"}`
- **Three emit formats:** Claude Code `sandbox.network.allowedDomains` JSON, a Codex permission
  profile (TOML), or a full JSON dump. `--against .claude/settings.json` prints only what is missing.
- **Careful wildcards:** 3+ distinct hosts under one base domain become `*.base` (Claude) / `**.base`
  (Codex). Never for IP literals, suspicious hosts, bases that contain a suspicious host, or
  shared-hosting platforms (`github.io`, `amazonaws.com`, `vercel.app`, `workers.dev`, …) where a
  wildcard would allow anyone's app.
- **Suspicious-host heuristics** (never auto-allowlisted): random-looking labels (>= 20 chars,
  >= 3.5 bits/char Shannon entropy), IP literals, paste/tunnel/request-catcher services
  (`pastebin.com`, `transfer.sh`, `ngrok`, `trycloudflare.com`, `webhook.site`, `oast.*`, …),
  and ports other than 80/443.
- **Agent self-traffic** (`api.anthropic.com`, `statsig.anthropic.com`, `sentry.io`,
  `api.openai.com`, `chatgpt.com`) is left out of emitted allowlists by default, because
  Claude Code's allowlist governs sandboxed Bash commands, not the agent's own API calls.
  `--include-agent-hosts` keeps them.
- **Report** in text or PR-pasteable Markdown: top hosts, flagged hosts with reasons, and which
  hosts are new compared with earlier sessions in the same directory.
- One runtime dependency (`commander`). No telemetry, no network calls of its own.

## Commands

```
egress-tap [--name <id>] [--dir .egress-tap] [--quiet] -- <cmd> [args...]
egress-tap emit   [--format claude|codex|json] [--wildcard-min 3]
                  [--include-agent-hosts] [--against <settings.json>] [session|latest]
egress-tap report [--format text|md] [session|latest]
egress-tap ls
```

The child gets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase variants) pointing at the
proxy, `NO_PROXY`/`no_proxy` removed, `NODE_USE_ENV_PROXY=1` (so Node's built-in `fetch` uses the
proxy) and `EGRESS_TAP_SESSION=<id>`. egress-tap's own messages go to stderr, so the child's
stdout stays clean for pipes.
Node children may print a one-time `[UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental`
on stderr because of `NODE_USE_ENV_PROXY`; it is harmless.

## Example output

This is real output from [`examples/fake-agent`](examples/fake-agent), a script that makes the
requests an agent makes while adding a dependency, plus one DNS-exfil-looking request:

```
$ egress-tap --name demo -- node agent.mjs
egress-tap: proxy 127.0.0.1:34685 · session demo
...agent output...
egress-tap: 8 hosts, 9 connections -> .egress-tap/demo.jsonl
  ! 1 suspicious host (run `egress-tap report` for details)
  next: egress-tap emit --format claude

$ egress-tap emit --format claude demo
{
  "sandbox": {
    "network": {
      "allowedDomains": [
        "*.npmjs.org",
        "api.github.com",
        "github.com",
        "npmjs.org",
        "pypi.org"
      ]
    }
  }
}
  hits  host                                          rule
     4  registry.npmjs.org                            *.npmjs.org, npmjs.org   (3 hosts: registry.npmjs.org, npmjs.org, www.npmjs.org)
     1  api.github.com                                api.github.com
     1  github.com                                    github.com
     1  pypi.org                                      pypi.org
     1  q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3.example.com  OMITTED: suspicious (random-looking label "q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3" (32 chars, 4.63 bits/char)), review it
  excluded agent hosts: api.anthropic.com (--include-agent-hosts to keep)
  WARNING: this is ONE session. Review every line before allowlisting; see `egress-tap report`.
```

(The table after the JSON is stderr, so `egress-tap emit > allow.json` captures only the JSON.)

```
$ egress-tap emit --format codex demo
# egress-tap: generated from session demo (9 connections, 8 hosts)
# Format: Codex permission profiles, https://learn.chatgpt.com/docs/permissions (verified 2026-09-27).
# Requires a Codex version with permission profiles; legacy network_access=true has no domain allowlist.
# Excluded agent hosts: api.anthropic.com (--include-agent-hosts to keep)
default_permissions = "egress-tap"

[features]
network_proxy = true

[permissions.egress-tap]
extends = ":workspace"

[permissions.egress-tap.network]
enabled = true

[permissions.egress-tap.network.domains]
"**.npmjs.org" = "allow"                                    # 4 hits: registry.npmjs.org, npmjs.org, www.npmjs.org
"api.github.com" = "allow"                                  # 1 hit
"github.com" = "allow"                                      # 1 hit
"pypi.org" = "allow"                                        # 1 hit
# "q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3.example.com" = "allow"  # SUSPICIOUS: random-looking label "q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3" (32 chars, 4.63 bits/char), 1 hit, review before enabling
```

```
$ egress-tap report demo
egress-tap report · session demo
  file:        .egress-tap/demo.jsonl
  window:      2026-09-27T18:28:28.946Z -> 2026-09-27T18:28:30.594Z (1.6s)
  connections: 9 (1 failed) · hosts: 8 · suspicious: 1 · agent: 1
  compared to: nothing (this is the only session in the directory)

Top 8 hosts
  hits  host                                          ports  down    up      first seen  notes
     2  registry.npmjs.org                            443    4.5 KB  3.9 KB  -
     1  api.anthropic.com                             443    4.6 KB  1.8 KB  -           agent
     1  api.github.com                                443    4.5 KB  1.8 KB  -
     1  github.com                                    443    8.5 KB  1.8 KB  -
     1  npmjs.org                                     443    3.5 KB  1.8 KB  -
     1  pypi.org                                      443    6.3 KB  1.8 KB  -
     1  q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3.example.com  443    0 B     0 B     -           suspicious: high-entropy; 1 error
     1  www.npmjs.org                                 443    3.5 KB  1.9 KB  -

Suspicious hosts (1)
  ! q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3.example.com  [1 hit, ports 443]
      high-entropy: random-looking label "q7x2k9m4v8p1z6w3r5t0y8u2i4o6a1s3" (32 chars, 4.63 bits/char)

Agent hosts (left out of `egress-tap emit` by default)
  api.anthropic.com  [1 hit]

FIRST SESSION: there is no earlier session to compare against.
WARNING: Do not blindly allowlist your first session: an agent that was already prompt-injected will have produced its exfil host here too.
```

## Target formats (verified 2026-09-27)

**Claude Code** ([sandboxing docs](https://code.claude.com/docs/en/sandboxing)):
`{"sandbox":{"network":{"allowedDomains":[...]}}}`. Wildcards are a leading `*.` only. The list
gates sandboxed Bash commands, not Claude's own API traffic. The docs do not say whether `*.x`
also matches the bare `x`, so when the apex was contacted egress-tap emits both `*.x` and `x`,
and `--against` does not treat `*.x` as covering `x`.

**Codex** ([permission profiles](https://learn.chatgpt.com/docs/permissions)): needs
`[features] network_proxy = true`; rules live in `[permissions.<name>.network.domains]` as
`"host" = "allow"`; `*.x` matches direct children only, `**.x` matches the apex and every
descendant, so egress-tap emits `**.x`. The profile is named `egress-tap`, extends `:workspace`
and is selected with top-level `default_permissions`. Permission profiles are new: older Codex
versions only have `[sandbox_workspace_write] network_access = true`, which is all-or-nothing
and has no domain-level equivalent.

egress-tap prints additions only. It never edits your settings files; you review and paste.

## What it does NOT catch

egress-tap sees what goes through its proxy and nothing else. Specifically, it misses:

- **Processes that ignore `HTTP(S)_PROXY`.** Many Go and Rust binaries with custom HTTP clients,
  and anything with its own proxy configuration, connect directly and never show up.
- **Raw TCP/UDP sockets** that are not HTTP (databases, custom protocols, QUIC/HTTP3).
- **`git` over SSH** (`git@github.com:…`). Only HTTPS remotes go through the proxy.
- **DNS lookups themselves.** Data smuggled out in DNS queries (DNS tunnelling) is invisible;
  egress-tap only sees the hostname a client asked the proxy to connect to.
- **Traffic from Claude Code's own sandbox proxy.** If the Claude Code sandbox is enabled while
  you observe, sandboxed commands talk to *its* proxy, not ours. Observe with the sandbox off.
- **Node `fetch` on Node < 22.21**, which ignores proxy env vars even with `NODE_USE_ENV_PROXY`,
  and Node code that opens sockets through its own agent without proxy support.
- **A child that sets `NO_PROXY` again** (or unsets the proxy variables) for its own subprocesses.
- **Anything that happens only in other sessions.** One run shows one path through the agent's
  behavior; a later task may need hosts this run never touched.

The heuristics are heuristics. A random-looking but legitimate label (for example a long storage
bucket name like `mycompanyproductionstorage`) can be flagged, and an exfil host with an
innocent-looking name will not be. URL paths and bodies are never seen (no TLS interception), so
two requests to `api.github.com` look the same whether they read a README or push your code.

**Do not blindly allowlist your first session:** an agent that was already prompt-injected will
have produced its exfil host there too. Read `egress-tap report`, compare against a second run,
and question every line before pasting.

## How it works

1. `egress-tap -- <cmd>` starts an HTTP proxy on `127.0.0.1:0`, creates `.egress-tap/<session>.jsonl`
   and spawns `<cmd>` with the proxy environment and inherited stdio.
2. `CONNECT host:port` requests are answered with `200 Connection Established` and piped both
   ways; absolute-URL requests are forwarded with hop-by-hop headers stripped. Upstream failures
   answer `502` and are logged with `status: "upstream_error"`.
3. When a connection closes, one JSON line is appended. When the child exits, open tunnels are
   closed and flushed, a summary goes to stderr, and egress-tap exits with the child's code
   (128 + signal number if it was killed). SIGTERM and SIGHUP are forwarded to the child; SIGINT is
   forwarded too unless stdin is a terminal (then the child already received it).
4. `emit` and `report` only read the log files. Nothing leaves your machine.

## Contributing

Issues and pull requests are welcome at https://github.com/canerinali/egress-tap.

```sh
git clone https://github.com/canerinali/egress-tap && cd egress-tap
npm install
npm test          # builds, then runs unit, proxy integration and CLI end-to-end tests (no internet needed)
```

Good first contributions: more multi-part suffixes in `src/domain.ts`, more paste/tunnel domains in
`src/heuristics.ts`, and reports of agents or tools whose traffic egress-tap misses. Please keep
runtime dependencies at one (`commander`) and add a test for every rule change.

## License

[MIT](LICENSE) © 2026 Caner İnali
