# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1   | No        |

Only the latest 0.1.x release gets security fixes. Upgrade before you report.

## Reporting a vulnerability

Do **not** open a public issue for a security problem.

Report it privately through GitHub private vulnerability reporting:
<https://github.com/canerinali/egress-tap/security/advisories/new>

Please include:

- the egress-tap version (`egress-tap --version`), Node version and OS;
- what an attacker controls (the observed child process, a session file, another local user, ...);
- a minimal reproduction, and what you expected to happen instead.

## What to expect

egress-tap is maintained by one person in their spare time. These are goals, not guarantees:

- acknowledgement within **7 days**;
- an initial assessment (accepted, needs more info, or out of scope) within **14 days**;
- a fix or documented mitigation for accepted issues within **90 days**, sooner for anything
  that makes an emitted allowlist more permissive than it looks.

Fixes ship as a new 0.1.x patch release with a GitHub Security Advisory. You are credited in
the advisory unless you ask not to be. Please give us a chance to ship the fix before you
disclose publicly.

## Scope

In scope:

- the `egress-tap` CLI and its local proxy (`src/`, the published `dist/`);
- emitted allowlists that are broader than the recorded traffic justifies (for example a
  wildcard over a multi-tenant hosting or storage domain);
- output injection: session data that can forge or hide lines in reports, or break the
  emitted JSON/TOML/Markdown;
- path handling of session names, `--dir` and `--against`;
- anything that makes egress-tap itself contact the network other than forwarding the
  child's own traffic.

## What egress-tap deliberately does not do

These are design limits, not vulnerabilities. Reports that only restate them are out of scope.

- **It does not block anything.** The proxy is observe-only: every request the child makes is
  forwarded. Do not run untrusted code under egress-tap expecting containment; run it inside the
  sandbox you are building the allowlist for.
- **It only sees traffic that honors the proxy.** A child that ignores `HTTP(S)_PROXY` /
  `ALL_PROXY`, opens raw sockets, uses UDP/QUIC, or resolves DNS itself (DNS exfiltration) is
  not recorded. A session log is a lower bound of what the child contacted.
- **It does not inspect TLS.** HTTPS is tunnelled with `CONNECT`; only host, port, method, byte
  counts and timing are logged. No URL paths, query strings, headers or bodies are stored.
- **The proxy has no authentication.** It listens on `127.0.0.1` only, on an ephemeral port,
  for the lifetime of one run. During that time any local process (including other users on a
  shared machine) can relay through it and add hosts to the session log. Do not record sessions
  on machines shared with people you do not trust.
- **Session files are trusted input.** `report` and `emit` read `.egress-tap/*.jsonl`. Lines
  that the proxy could not have written are skipped, but a session file planted in a cloned
  repository can still contain plausible hostnames and influence `latest` and the
  "new since previous sessions" comparison. Keep `.egress-tap/` in `.gitignore` and pass an
  explicit session id when in doubt.
- **An allowlist from one session is not proof of safety.** An agent that was already
  prompt-injected will have produced its exfiltration host in that session too. Review every
  line; the suspicious-host heuristics are hints, not a detector.
- **No telemetry.** egress-tap makes no network calls of its own.
