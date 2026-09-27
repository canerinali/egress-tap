# egress-tap — v0.1 Build Plan

> Scope contract: one agent, ~1 hour of coding. No TODOs, no "phase 2 hooks". Runtime deps: `commander` only.

## 1. Value proposition

Run your coding agent once behind `npx egress-tap -- claude` in observe mode, and get back the exact least-privilege network allowlist (Claude Code `settings.json` / Codex `config.toml`) it actually needed, with the suspicious hosts called out before you lock it in.

## 2. MVP will NOT do

- **No `@anthropic-ai/sandbox-runtime` integration.** It exists (Apache-2.0; it is what Claude Code's own sandbox is built on) and an OS-level "audit" mode on top of it is the v0.2 headline, because it would also catch processes that ignore proxy env vars. v0.1 is a plain env-var proxy.
- No TLS interception / MITM, no CA install, no URL paths or bodies. We see only `host:port` from `CONNECT` and the `Host`/absolute URL for plain HTTP.
- No enforce / block mode (`--deny-unlisted` rejected: blocking needs error UX and a policy story; the product is *observe then emit*). Everything is allowed and forwarded.
- No DNS logging or DNS-tunnel detection (v0.2). No SOCKS5 server (`ALL_PROXY` is set to the HTTP proxy URL; clients that require SOCKS just won't use it).
- No per-process attribution (the `pid` from the original issue is dropped: a proxy cannot know which child opened the socket without OS hooks).
- No GitHub Action, no demo GIF, no web UI, no merging *into* an existing settings file (we print additions only; the human pastes).
- No public-suffix-list dependency: a small hard-coded multi-part-suffix list (`co.uk`, `com.tr`, `com.au`, ...) is enough for v0.1.

## 3. Verified target formats (checked 2026-09-27)

**Claude Code** (code.claude.com/docs/en/sandboxing): `{"sandbox":{"network":{"allowedDomains":["github.com","*.npmjs.org"]}}}`. Wildcard form is a leading `*.` only. It gates *sandboxed Bash commands*, not Claude's own API traffic, so emitters drop the agent's own hosts (see §6). Because it is not documented whether `*.x` matches the apex `x`, when the apex itself was seen we emit both `x` and `*.x`.

**Codex** (learn.chatgpt.com/docs/permissions, "permission profiles"): requires `[features] network_proxy = true`; rules live in `[permissions.<name>.network.domains]` as `"host" = "allow"`; `*.x` = direct children only, `**.x` = apex + all descendants. Profile selected by top-level `default_permissions`. We emit a profile named `egress-tap` with `extends = ":workspace"`. This profile system is new; the emitted snippet carries a header comment saying so, naming the doc URL and telling users on older Codex (legacy `[sandbox_workspace_write] network_access = true`, all-or-nothing) that no domain-level equivalent exists.

## 4. File / module layout

```
egress-tap/
├── package.json  tsconfig.json  vitest.config.ts  LICENSE (MIT)  README.md
├── src/
│   ├── cli.ts             shebang; commander: run (default `-- <cmd>`), emit, report, ls
│   ├── proxy.ts           startProxy({onEvent}) -> {port, close()}; http.Server + 'connect' handler
│   ├── run.ts             start proxy, spawn child with proxy env, forward signals, propagate exit code
│   ├── env.ts             buildChildEnv(parentEnv, port) -> env (pure, unit-tested)
│   ├── log.ts             session id, JSONL append writer, readSession(id|"latest")
│   ├── aggregate.ts       events -> HostStat[] {host, ports, hits, bytesUp, bytesDown, firstTs, kinds}
│   ├── domain.ts          baseDomain(host), isIpLiteral(host), MULTI_PART_SUFFIXES, SHARED_HOSTING
│   ├── wildcard.ts        suggest(HostStat[], {min}) -> Rule[] {pattern, covers[], hits}
│   ├── heuristics.ts      flag(host, port) -> Flag[] (entropy, ip-literal, paste/tunnel, odd-port)
│   ├── agentHosts.ts      known agent self-traffic (api.anthropic.com, statsig.anthropic.com,
│   │                      sentry.io, api.openai.com, chatgpt.com, ab.chatgpt.com)
│   ├── emit/claude.ts     Rule[] -> settings.json fragment
│   ├── emit/codex.ts      Rule[] -> TOML profile snippet (hand-written string building)
│   ├── emit/json.ts       full machine-readable dump
│   └── report.ts          text | md session report (top hosts, flags, first-session warning)
└── test/
    ├── env.test.ts  domain.test.ts  wildcard.test.ts  heuristics.test.ts
    ├── emit.test.ts  report.test.ts
    ├── proxy.test.ts      proxy + local upstream, in-process
    ├── cli.e2e.test.ts    built CLI: `egress-tap -- node fixtures/client.mjs ...`
    └── fixtures/client.mjs, sample-session.jsonl
```

## 5. CLI interface

```
$ npx egress-tap [--name <id>] [--dir .egress-tap] [--quiet] -- <cmd> [args...]
$ npx egress-tap emit   [--format claude|codex|json] [--wildcard-min 3]
                        [--include-agent-hosts] [--against <settings.json>] [session|latest]
$ npx egress-tap report [--format text|md] [session|latest]
$ npx egress-tap ls
```

Run: sets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (+ lowercase variants) to `http://127.0.0.1:<port>`, deletes `NO_PROXY`/`no_proxy`, sets `NODE_USE_ENV_PROXY=1` (Node >= 22.21/24 fetch honors env proxies only with it), `EGRESS_TAP_SESSION=<id>`. Child exit code is our exit code. Summary goes to stderr so the child's stdout stays clean.

```
$ npx egress-tap -- claude -p "add a test and run npm install"
egress-tap: proxy 127.0.0.1:41873 · session 2026-09-27T14-03-11Z
...claude output...
egress-tap: 9 hosts, 212 connections -> .egress-tap/2026-09-27T14-03-11Z.jsonl
  ! 1 suspicious host (run `egress-tap report` for details)
  next: egress-tap emit --format claude
```

JSONL line (one per connection, written on close):
```json
{"ts":"2026-09-27T14:03:15.120Z","kind":"connect","host":"registry.npmjs.org","port":443,"method":"CONNECT","bytesUp":1830,"bytesDown":48211,"durationMs":412,"status":"ok"}
```
`kind`: `connect` | `http`; `status`: `ok` | `upstream_error` | `bad_request`; `method` for `http` is the real verb.

```
$ npx egress-tap emit --format claude
{
  "sandbox": {
    "network": {
      "allowedDomains": ["*.npmjs.org", "api.github.com", "github.com", "npmjs.org", "pypi.org"]
    }
  }
}
# stderr:
#   hits  host                       rule
#    141  registry.npmjs.org         *.npmjs.org   (3 subdomains)
#     22  api.github.com             api.github.com
#      6  paste.ee                   OMITTED: suspicious (paste/tunnel service), review it
#   excluded agent hosts: api.anthropic.com, statsig.anthropic.com (--include-agent-hosts to keep)
#   WARNING: this is ONE session. Review every line before allowlisting; see `egress-tap report`.
```
Suspicious hosts are **never** auto-wildcarded and are emitted commented out in codex output / omitted from claude JSON with a stderr line saying so (JSON has no comments).

```
$ npx egress-tap emit --format codex
# egress-tap: generated from session 2026-09-27T14-03-11Z (212 connections, 9 hosts)
# Format: Codex permission profiles, https://learn.chatgpt.com/docs/permissions (verified 2026-09-27).
# Requires a Codex version with permission profiles; legacy network_access=true has no domain allowlist.
default_permissions = "egress-tap"

[features]
network_proxy = true

[permissions.egress-tap]
extends = ":workspace"

[permissions.egress-tap.network]
enabled = true

[permissions.egress-tap.network.domains]
"**.npmjs.org" = "allow"      # 141 hits: registry.npmjs.org, www.npmjs.org, npmjs.org
"api.github.com" = "allow"    # 22 hits
# "paste.ee" = "allow"        # SUSPICIOUS: paste/tunnel service, 6 hits, review before enabling
```

`--against .claude/settings.json` prints only domains not already covered by the file's `sandbox.network.allowedDomains` (`+ pypi.org`). `report --format md` output is PR-pasteable: session meta, top 10 hosts table, flagged hosts with reasons, first-seen-vs-previous-sessions column (compares with other files in the dir), and the fixed warning block *"Do not blindly allowlist your first session: an agent that was already prompt-injected will have produced its exfil host here too."*

## 6. Rules (the logic that matters)

- **Wildcard:** group by `baseDomain(host)`; if >= `--wildcard-min` (3) distinct hosts share a base, emit `*.base` (claude) / `**.base` (codex), plus the bare apex for claude if seen. Never wildcard IP literals, flagged hosts, or `SHARED_HOSTING` bases (`github.io`, `githubusercontent.com`, `amazonaws.com`, `cloudfront.net`, `herokuapp.com`, `vercel.app`, `netlify.app`, `workers.dev`, `pages.dev`, `azurewebsites.net`, `appspot.com`) — wildcarding those allows anyone's app.
- **Heuristics** (each yields `{code, reason}`): `high-entropy` = any label >= 20 chars with Shannon entropy >= 3.5 bits/char; `ip-literal` = IPv4 or IPv6 target; `paste-tunnel` = suffix match against a list (pastebin.com, paste.ee, hastebin.com, termbin.com, transfer.sh, ngrok.io, ngrok-free.app, ngrok.app, trycloudflare.com, loca.lt, localtunnel.me, serveo.net, webhook.site, requestbin.net, pipedream.net, interact.sh, oast.fun/oast.pro/oast.live, burpcollaborator.net); `odd-port` = port not 80/443.
- **Agent hosts** are excluded from emit by default (Claude's allowlist governs Bash subprocesses, not the agent's own API calls), still shown in report.

## 7. Implementation steps (in order)

1. **Scaffold.** package.json, tsconfig (strict, `module: nodenext`, `outDir: dist`), vitest config, LICENSE, empty `cli.ts` with commander wiring and `--version`.
   *Done:* `npm run build && node dist/cli.js --help` lists run/emit/report/ls.
2. **Proxy.** `proxy.ts`: `http.createServer` on `127.0.0.1:0`; `request` handler forwards absolute-URL plain-HTTP requests via `http.request` (strip hop-by-hop headers); `connect` handler opens `net.connect(port, host)`, replies `200 Connection Established`, pipes both ways, counts bytes, emits one event on close; upstream errors -> `502` + `status:"upstream_error"`. Never crash on socket errors.
   *Done:* `proxy.test.ts` green: CONNECT tunnel and plain-HTTP forward to a local upstream both return the body and emit correct host/port/bytes events.
3. **Run + log.** `env.ts`, `log.ts`, `run.ts`: session id (ISO, `:` -> `-`, or `--name`), mkdir `.egress-tap/`, append JSONL, spawn with `stdio:'inherit'`, forward SIGINT/SIGTERM, close proxy and flush after child exit, print summary, exit with child's code (128+signal if killed).
   *Done:* `env.test.ts` green; manual `node dist/cli.js -- curl -s https://example.com -o /dev/null` writes one `example.com:443` line.
4. **Aggregate + domain + heuristics.** Pure functions with unit tests.
   *Done:* `domain.test.ts` (`a.b.co.uk` -> `b.co.uk`, IPv6 detection) and `heuristics.test.ts` (random 32-char label flagged, `registry.npmjs.org` not, `1.2.3.4` flagged, `x.trycloudflare.com` flagged) green.
5. **Wildcard + emitters.** `wildcard.ts`, `emit/claude.ts`, `emit/codex.ts`, `emit/json.ts`, `--against`, agent-host exclusion.
   *Done:* `emit.test.ts` snapshot-asserts all three formats from `fixtures/sample-session.jsonl`; claude output `JSON.parse`s and has `sandbox.network.allowedDomains`; codex output contains `network_proxy = true` and `"**.npmjs.org" = "allow"`; no `*.github.io` ever produced.
6. **Report + ls.** text and md renderers, first-seen comparison, fixed warning block.
   *Done:* `report.test.ts` asserts flagged hosts and the warning text appear in both formats.
7. **E2E + README.** `cli.e2e.test.ts` (below); README with pitch, 3-command quickstart, real pasted output, verified-format notes (§3), and **"What it does NOT catch"**: processes that ignore `HTTP(S)_PROXY` (many Go/Rust binaries with custom clients, anything with its own proxy config), raw TCP/UDP sockets, `git` over SSH (`git@github.com:`), DNS lookups themselves (DNS-tunnel exfil is invisible), traffic from Claude Code's *own* sandbox proxy if its sandbox is enabled during observation (observe with the sandbox off), Node `fetch` on Node < 22.21 without `NODE_USE_ENV_PROXY`, and `NO_PROXY` set again inside the child. Plus "don't blindly allowlist the first session".
   *Done:* `npm test` fully green; README renders; `npm pack --dry-run` contains only `dist/`, README, LICENSE.

## 8. Test strategy

- **Unit (pure):** env building (NO_PROXY removed, all six proxy vars set), baseDomain/multi-part suffixes, entropy threshold edges, wildcard threshold and shared-hosting refusal, emitter output (inline snapshots), report content.
- **Integration (`proxy.test.ts`, in-process):** start a local `http` upstream on `127.0.0.1:0`; start proxy; (a) `http.request({host:proxy, path:"http://localhost:<up>/x"})` -> body ok + event `{kind:"http",host:"localhost",method:"GET"}`; (b) `http.request({method:"CONNECT", path:"localhost:<up>"})`, then speak HTTP over the tunnel socket -> body ok + event `{kind:"connect", bytesDown>0}`; (c) CONNECT to a closed port -> 502 + `upstream_error`.
- **E2E (`cli.e2e.test.ts`, real child process, no network):** runs `node dist/cli.js --name t1 --dir <tmp> -- node test/fixtures/client.mjs http://localhost:<up>/`. `client.mjs` reads `HTTPS_PROXY`/`HTTP_PROXY` from env and does both a CONNECT and an absolute-URL GET by hand with `node:http` (deterministic on every Node 22 minor, unlike env-proxy `fetch`). Asserts: child exit code propagated (fixture exits 7 on purpose), `<tmp>/t1.jsonl` has exactly 2 lines with `host:"localhost"`, correct port, kinds `connect` and `http`. Then `emit --format json t1` parses and lists `localhost` with `hits:2`.
- **Optional:** `describe.skipIf(!hasCurl)` runs `-- curl -s http://localhost:<up>/` relying only on the env proxy vars, asserting one `http` line (proves real-world tools honor our env).
- No test touches the internet. CI matrix: Node 22 and 24, ubuntu-latest.

## 9. package.json essentials

```json
{
  "name": "egress-tap",
  "version": "0.1.0",
  "description": "Record every host your AI coding agent contacts, then emit a least-privilege Claude Code / Codex network allowlist.",
  "license": "MIT",
  "type": "module",
  "bin": { "egress-tap": "dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "npm run build && vitest run",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": { "commander": "^14" },
  "devDependencies": { "typescript": "^5", "vitest": "^3", "@types/node": "^22", "tsx": "^4" },
  "keywords": ["claude-code", "codex", "ai-agent", "sandbox", "allowlist", "egress", "proxy", "security"]
}
```
Use the latest majors available at build time for the dev deps; the pins above are floors, not requirements. Repo: `canerinali/egress-tap`, author `canerinali` (personal identity only).
