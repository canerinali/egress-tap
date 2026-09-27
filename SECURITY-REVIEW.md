# Security review: egress-tap v0.1.0

Date: 2026-09-27. Scope: `src/`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml`,
`examples/`, full git history. Method: source read-through, `npm audit`, git history secret
scan, license inventory, and live probes of the proxy with hostile `CONNECT` lines and `Host`
headers.

## Summary

| Severity | Count | Fixed | Accepted / open |
|----------|------:|------:|----------------:|
| High     | 0 | 0 | 0 |
| Medium   | 1 | 1 | 0 |
| Low      | 5 | 3 | 2 accepted, 1 partial |
| Info     | 10 | n/a | n/a |

- `npm audit`: 0 vulnerabilities (full tree and `--omit=dev`).
- Runtime dependency: `commander` (MIT) only. All other packages are dev-only.
- No secrets, `.env` files or `.egress-tap/` session logs in the tree or in git history.
- No telemetry: the only outbound sockets are the proxy's forwarding calls.

---

## Medium

### M1. Wildcard suggestions over multi-tenant storage/hosting domains

- **Location:** `src/domain.ts` (`SHARED_HOSTING`), used by `src/wildcard.ts` `suggest()`.
- **Description:** A base domain becomes a wildcard once 3 distinct hosts under it are seen.
  The shared-hosting deny list only held 11 bases. Many common multi-tenant platforms were
  missing, where any customer can own a subdomain. Realistic traffic produced dangerous rules:
  three Azure Blob hosts (`*.blob.core.windows.net`, common for GitHub Actions artifacts and
  VS Code downloads) produced `*.windows.net`. Three GCS/Firebase/R2/Fly hosts produced
  `*.googleapis.com`, `*.web.app`, `*.r2.dev` or `*.fly.dev`. Each of these rules lets a
  prompt-injected agent exfiltrate to an attacker-owned storage account or app while the user
  believes they have a least-privilege allowlist.
- **Recommendation:** Extend the list to the major hosting, object-storage, serverless, CDN-tenant
  and blog platforms. Longer term, consider the Public Suffix List's private section, which
  would add a dependency.
- **Status:** **Fixed.** `SHARED_HOSTING` now holds about 65 bases: Azure (`windows.net`,
  `azure.com`, `azureedge.net`, ...), Google (`googleapis.com`, `googleusercontent.com`, `run.app`,
  `web.app`, Firebase), Cloudflare (`r2.dev`, `cloudflarestorage.com`), AWS (`on.aws`, ...) and common
  PaaS/blog hosts. Hosts under these bases stay exact rules.
  **Re-verification:** new tests in `test/domain.test.ts` and `test/emit.test.ts` ("never
  wildcards multi-tenant storage") failed before the fix and pass after it. A CLI run on a session with
  `a|b|c.blob.core.windows.net` now emits three exact hosts instead of `*.windows.net`.

## Low

### L1. Session files trusted: terminal/Markdown/TOML injection from a tampered or planted JSONL

- **Location:** `src/log.ts` `isEvent()`/`parseJsonl()`/`listSessions()`, which feed
  `src/report.ts`, `src/emit/explain.ts`, `src/emit/codex.ts` and `src/cli.ts` `ls`.
- **Description:** The live proxy can only record printable ASCII hosts: Node's HTTP parser
  rejects control and non-ASCII bytes in the request line and `Host` (verified by probe). But
  `parseJsonl` accepted any non-empty string for `host`, `ts` and `method`. A session file that
  was edited or planted (for example `.egress-tap/` committed to a cloned repo) could inject ANSI
  escapes into `report`/`emit` stderr. For example, `\x1b[2K` erases the "SUSPICIOUS" line. It could
  also inject bidi overrides, or a DEL byte, which makes the Codex TOML invalid because TOML forbids
  DEL in comments. Session file names with control characters reached error messages through `ls`.
- **Recommendation:** Validate on ingestion and accept only what the proxy can produce.
- **Status:** **Fixed.** `host` must match `^[\x21-\x7e]{1,255}$`, `ts` must be an ISO-8601 UTC
  timestamp, `port` must be an integer from 0 to 65535, and `method` must be letters only (anything else becomes an empty string).
  `listSessions` ignores files whose names `createSession` could not have produced.
  **Re-verification:** tests in `test/log.test.ts` ("rejects hosts and timestamps...", "ignores
  session files...") fail before the fix and pass after it. A CLI `report` on a file containing
  `evil\x1b[2K.com` outputs no escape bytes.

### L2. Session logs readable by other local users

- **Location:** `src/log.ts` `createSession()`.
- **Description:** `.egress-tap/` and `*.jsonl` were created with default modes (0755/0644 under
  a typical umask). Hostnames reveal internal services, customers and projects.
- **Recommendation:** Create the directory with 0700 and files with 0600.
- **Status:** **Fixed.** `mkdirSync(..., { mode: 0o700 })` and `writeFileSync(..., { flag: 'wx', mode: 0o600 })`.
  A directory that already exists keeps its mode.
  **Re-verification:** test "creates the log dir and files owner-only" passes. A CLI run shows
  `700` for the directory and `600` for the session file.

### L3. Unauthenticated loopback proxy: local relay and log poisoning

- **Location:** `src/proxy.ts` `startProxy()`.
- **Description:** The proxy binds `127.0.0.1` on an ephemeral port with no authentication.
  While a run is active, any local process, including another user on a shared host, can:
  (a) relay traffic through it (an open relay on loopback), and (b) add arbitrary hosts to the
  session. Relative-URL requests are also logged as `bad_request` with their `Host` header, and
  those hosts then appear as allowlist suggestions. The relay itself gives no capability a local
  user lacks, because they can connect out directly. Log poisoning could slip an attacker domain
  into the victim's allowlist.
- **Recommendation:** Document it (done in SECURITY.md). A possible future hardening is a
  per-run random credential in the proxy URL (`http://tap:<token>@127.0.0.1:port`) with
  `Proxy-Authorization` enforced. This needs care, because clients that drop credentials would
  stop being observed. Also consider excluding `bad_request` events from `emit` rules, since no
  egress happened for them.
- **Status:** **Accepted (documented)** for v0.1. This is the inherent design of an observe-only
  local proxy. The warning to review every line applies.

### L4. Planted session history influences `latest` and "new since previous sessions"

- **Location:** `src/log.ts` `readSession('latest')`, `previousHosts()`.
- **Description:** `latest` is chosen by mtime, and git checkout sets the mtime to the checkout time.
  A repo that commits `.egress-tap/*.jsonl` can make its own file `latest`. It can also pre-seed an
  exfiltration host so that `report` labels it "seen" instead of "NEW". After L1 the content must
  still look like a valid hostname.
- **Recommendation:** Keep `.egress-tap/` gitignored (this repo already does), pass explicit
  session ids, and consider warning when a session file is tracked by git.
- **Status:** **Accepted (documented)** in SECURITY.md.

### L5. CI workflow hardening

- **Location:** `.github/workflows/ci.yml`.
- **Description:** No `permissions:` block, so the job used the repository's default `GITHUB_TOKEN`
  scope. Third-party actions are pinned by tag (`@v4`), not by commit SHA.
- **Recommendation:** Set `permissions: contents: read` and pin actions to SHAs, with Dependabot
  keeping them current.
- **Status:** **Partially fixed.** Added `permissions: contents: read`. SHA pinning is left open.

## Info

- **I1. No shell / command injection.** `src/run.ts` calls `spawn(command, args, { stdio: 'inherit', env })`
  with an argv array and no `shell` option. Arguments after `--` are passed to the child verbatim.
- **I2. Bind address.** The proxy defaults to `127.0.0.1` (`src/proxy.ts`). The `host` option is not
  exposed on the CLI, and the child env points at `http://127.0.0.1:<port>` (`src/env.ts`).
- **I3. Hostile hostnames from the live proxy.** Probed with ESC, bidi, `|`, backtick, `*` and
  bracketed-IPv6 junk in `CONNECT` and `Host`. Control and non-ASCII bytes are rejected with 400
  by Node's parser. Printable oddities are safe in every output path: Markdown escapes `|` and
  backtick (`mdCode`), JSON and TOML keys go through `JSON.stringify`, and invalid hostnames are
  flagged `invalid-host`. Flagged hosts are omitted from the Claude allowlist and commented out
  in TOML, with `commentSafe`.
- **I4. Regex DoS.** `parseAuthority`, `HOSTNAME_RE` and `normalizeHost` are linear. Inputs of
  50k to 100k characters complete in under 5 ms.
- **I5. Resource exhaustion.** Header parsing is bounded by Node defaults (16 KiB
  `maxHeaderSize`, `headersTimeout`). Connection count is unbounded, and events (about 200 B each) are
  kept in memory for the run summary. This is acceptable for a local dev tool, but a
  misbehaving child with millions of connections grows memory linearly.
- **I6. Data minimisation.** Only host, port, method, byte counts, timing and error codes are logged.
  URL paths, query strings, headers and bodies are never stored. `Proxy-Authorization` and other
  hop-by-hop headers are stripped before forwarding.
- **I7. Reachability.** The proxy forwards to any address, including loopback and private ranges.
  This is not an escalation, since the child can connect there directly. The proxy never blocks.
- **I8. Path handling.** Session names are validated by `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, so
  `../` is rejected. `readSession` reduces `*.jsonl` refs to their basename. Sessions are created with
  `O_EXCL` (`wx`), which refuses to follow a pre-planted symlink. `--dir` and `--against` are
  paths the user supplies and are read with the user's own rights, which is intended.
- **I9. Secrets and packaging.** `git log -p` over all refs matched only benign test strings
  (`x-secret` hop-by-hop header test, a `token` loop variable). No `.env`, keys or session logs have ever
  been committed. `.gitignore` covers `.egress-tap/`. `npm pack` ships only `dist/`, `README.md`,
  `LICENSE` and `package.json`.
- **I10. Licenses and network.** The runtime dependency `commander` is MIT. The dev tree has MIT (75),
  Apache-2.0 (23), MPL-2.0 (12, all `lightningcss*` via vitest), ISC (1) and BSD-3-Clause (1). All are
  dev-only and not redistributed, so they are compatible with MIT. No telemetry: the only
  outbound calls in `src/` are `net.connect` (`CONNECT` tunnels) and `http(s).request` (plain-HTTP forwarding).
  `version.ts` reads the local `package.json`.

## Verification

`npm test`: 8 files, 70 tests passed. `npm audit`: 0 vulnerabilities (full tree and `--omit=dev`).
