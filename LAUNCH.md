# egress-tap launch plan

Goal: the first 100 GitHub stars for https://github.com/canerinali/egress-tap.

> **Status (2026-09-29, 11:40 TRT).** Ready to post.
>
> - The repo is public: topics set, `v0.1.0` released, CI green, the demo GIF in the README.
> - The package is on npm: `egress-tap@0.1.0`. `npx egress-tap` was smoke-tested from an empty
>   directory, both the record and the emit steps.
> - The demo GIF was rendered with `python3 demo/make-gif.py` from real captured CLI output
>   (`demo/out1.txt`, `demo/out2.txt`). The vhs tape still works as an alternative.

---

## 1. README first screen

Applied to the top of `README.md` (the rest of the README is unchanged).

**Title:** `egress-tap`

**One sentence:** Record every host your AI coding agent contacts, then emit the least-privilege
Claude Code / Codex network allowlist it actually needed.

**Install / usage (first lines, above the badges):**

```
Install: `npm install -g egress-tap` (or run it with `npx egress-tap`, Node >= 22)
Usage: `npx egress-tap -- claude -p "add a test and run npm install" && npx egress-tap emit --format claude`
```

**Three bullets:**

- **See what your agent really reached.** An observe-only local proxy logs one line per
  connection (`host:port`, bytes, duration). No TLS interception, no CA to install, nothing blocked.
- **Get a paste-ready allowlist.** Claude Code `sandbox.network.allowedDomains` JSON or a Codex
  permission profile, with careful wildcards (`*.npmjs.org` yes, `*.github.io` never).
- **Catch exfil hosts before you lock them in.** Random-looking subdomains, IP literals,
  paste/tunnel services and odd ports are flagged and never auto-allowlisted.

The demo GIF (`demo/demo.gif`) sits under the bullets.

---

## 2. Demo plan

**What to record** (about 20 seconds, no Claude login, no API key):

1. `egress-tap --name demo -- node --no-warnings agent.mjs` in `examples/fake-agent/`: the fake
   agent's 9 `fetch()` calls scroll by, then the summary
   `8 hosts, 9 connections` and `! 1 suspicious host`.
2. `egress-tap emit --format claude demo`: the `allowedDomains` JSON (`*.npmjs.org`,
   `api.github.com`, `github.com`, `npmjs.org`, `pypi.org`), then the stderr table showing the
   32-char random subdomain `OMITTED: suspicious` and `api.anthropic.com` excluded as agent traffic.

The money shot is frame 2: a clean allowlist plus the one host you must not allowlist. Hold it
for about 6 seconds. The fake agent needs internet for its own requests; the random host does not
resolve, which is intended (it is logged and flagged anyway). Dry-run on 2026-09-27 produced
exactly this output.

**vhs tape** (saved as `demo/demo.tape`, run from the repo root after `npm install && npm run build`):

```tape
# egress-tap demo GIF, recorded with vhs (https://github.com/charmbracelet/vhs).
# No Claude login needed: the "agent" is examples/fake-agent/agent.mjs (plain fetch()).
# Needs internet for the fake agent's requests and a built checkout.
#
#   npm install && npm run build
#   vhs demo/demo.tape          # run from the repo root; writes demo/demo.gif

Output demo/demo.gif

Require node

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 760
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set WindowBar Colorful

# Setup, not recorded: use the local build as `egress-tap`, start from a clean session dir.
Hide
Type "cd examples/fake-agent && rm -rf .egress-tap && egress-tap() { node ../../dist/cli.js \"$@\"; } && export PS1='$ ' && clear"
Enter
Show

# 1. Observe: run the "agent" behind egress-tap.
Type "egress-tap --name demo -- node --no-warnings agent.mjs"
Sleep 400ms
Enter
Wait+Screen@30s /next: egress-tap emit/
Sleep 2.5s

# 2. Emit the least-privilege Claude Code allowlist.
Type "clear && egress-tap emit --format claude demo"
Sleep 400ms
Enter
Wait+Screen@10s /WARNING/
Sleep 6s

# Cleanup, not recorded.
Hide
Type "rm -rf .egress-tap && cd ../.."
Enter
```

Notes: `Wait+Screen` needs vhs >= 0.8. If DNS for the random host is slow on your network, the
first step can idle for several seconds; re-record or trim with `gifsicle`.

**asciinema alternative** (idle time capped at 1.5 s, then converted to GIF with `agg`):

```sh
npm install && npm run build
cd examples/fake-agent && rm -rf .egress-tap
asciinema rec --idle-time-limit 1.5 --cols 120 --rows 32 ../../demo/demo.cast \
  -c 'bash -c "node ../../dist/cli.js --name demo -- node --no-warnings agent.mjs; sleep 2; clear; node ../../dist/cli.js emit --format claude demo; sleep 6"'
rm -rf .egress-tap && cd ../..
agg --theme monokai --font-size 16 demo/demo.cast demo/demo.gif
```

---

## 3. Share texts (copy-paste ready)

Replace nothing: all links point to the final repo URL. Post only after the repo is public and
`npm publish` has succeeded (otherwise the `npx` line in every post is broken).

### Show HN

**Title** (79 chars, HN limit is 80):

```
Show HN: Egress-tap – learn which hosts your coding agent needs, then allowlist
```

**URL field:** `https://github.com/canerinali/egress-tap`

**First comment:**

```
Hi HN, I built egress-tap because turning on the Claude Code sandbox (or Codex permission profiles) asks you a question nobody can answer from memory: which domains does this agent actually need?

egress-tap runs your agent once behind a tiny local proxy in observe mode. It sets HTTP(S)_PROXY for the child, forwards everything unchanged (CONNECT tunnels, no TLS interception, no CA), and writes one JSON line per connection: host:port, bytes, duration. Then:

  npx egress-tap -- claude -p "add a test and run npm install"
  npx egress-tap emit --format claude     # or --format codex

prints the allowlist in sandbox.network.allowedDomains form, or as a Codex permission profile in TOML.

Some decisions I'd like feedback on:

- Wildcards only when 3+ hosts share a base domain, and never on shared-hosting suffixes (github.io, vercel.app, workers.dev, amazonaws.com...), because *.github.io allows anyone's page.
- Hosts that look like exfiltration (high-entropy labels like q7x2k9m4...example.com, IP literals, paste/tunnel services such as webhook.site or trycloudflare.com, non-80/443 ports) are never auto-allowlisted; they're printed with the reason.
- The agent's own API hosts (api.anthropic.com, api.openai.com...) are left out by default, since Claude Code's allowlist governs sandboxed Bash commands, not the agent's own traffic.

What it does NOT catch, loudly: anything that ignores proxy env vars (many Go/Rust binaries), raw sockets, git over SSH, DNS tunnelling, and it can't see URL paths. The README has the full list. It's also not a reason to blindly trust your first session: if the agent was already prompt-injected, the exfil host is in that log too, which is why the report diffs against earlier sessions.

TypeScript, MIT, one runtime dependency (commander), no telemetry. The demo uses a fake agent script, so you can try it without any login: examples/fake-agent/run.sh.

Next I'm looking at an OS-level audit mode on top of Anthropic's sandbox-runtime so proxy-ignoring processes show up too. Happy to answer questions.
```

### Reddit

| Subreddit | Why | When |
|---|---|---|
| r/ClaudeCode | ~395k members; "Built with Claude" / "Tips & Workflows" flair; the sandbox allowlist is a daily pain point there | Wed 2026-09-30 |
| r/ClaudeAI | Largest Claude community; broader reach, stricter self-promo rules, so lead with the problem | Thu 2026-10-01 |
| r/netsec | Security audience that cares about the exfil heuristics; only accepts technical write-ups, so post the dev.to article link, not the repo | Tue 2026-10-06 |

Check each sub's current self-promotion rules and required flair right before posting. There may
be a Codex subreddit worth adding; I could not verify one, so check before using it.

**r/ClaudeCode post** (flair: Built with Claude / Showcase)

Title:
```
I got tired of guessing sandbox.network.allowedDomains, so I built a tool that records what Claude Code actually contacts
```

Body:
```
When you turn on the Claude Code sandbox you need an allowlist, and I never knew what to put in it. Too narrow and npm install breaks mid-task; too wide ("*.com" energy) and the sandbox is decoration.

egress-tap runs the agent once behind a local observe-only proxy and turns the log into the allowlist:

    npx egress-tap -- claude -p "add a test and run npm install"
    npx egress-tap report
    npx egress-tap emit --format claude      # paste into .claude/settings.json

What it does that I couldn't do by hand:
- collapses registry.npmjs.org / www.npmjs.org / npmjs.org into *.npmjs.org, but never wildcards shared hosting like github.io or vercel.app
- flags exfil-looking hosts (random 32-char subdomains, IPs, webhook.site, ngrok, odd ports) and refuses to allowlist them
- --against .claude/settings.json prints only what's missing from your current list
- also emits a Codex permission profile if you use both

Important: observe with the sandbox OFF (otherwise commands go through Claude's own proxy, not mine), and don't blindly trust the first run. The README has a "what it does NOT catch" section (proxy-ignoring binaries, SSH git, DNS tunnelling).

MIT, no telemetry, one dependency. There's a fake-agent demo that needs no login: https://github.com/canerinali/egress-tap

Would love to hear which hosts it misses in your setups.
```

**r/ClaudeAI post** (flair: Built with Claude or equivalent)

Title:
```
PSA-ish: your Claude Code sandbox allowlist is probably either too wide or breaking npm install. I built a small tool to generate it from a real run
```

Body: reuse the r/ClaudeCode body, dropping the Codex bullet.

**r/netsec post:** link post to the dev.to article (below), title =
`Deriving least-privilege egress allowlists for AI coding agents from an observe-only proxy (and what it can't see)`.

### X / Twitter thread (5 tweets)

```
1/ Turning on the Claude Code sandbox or Codex permission profiles asks one question: which domains does your agent actually need?

I built egress-tap to answer it from a real run instead of guesswork. 🧵
[attach demo.gif]
```

```
2/ Run the agent once behind a local observe-only proxy:

npx egress-tap -- claude -p "add a test and run npm install"

Every connection is logged: host, port, bytes, duration. No TLS interception, no CA, nothing blocked.
```

```
3/ Then:

npx egress-tap emit --format claude   → sandbox.network.allowedDomains
npx egress-tap emit --format codex    → a Codex permission profile

Wildcards only when 3+ hosts share a base. Never *.github.io or *.vercel.app.
```

```
4/ The part I care most about: exfil-looking hosts are never auto-allowlisted.

Random 32-char subdomains, IP literals, webhook.site / ngrok / trycloudflare, odd ports: flagged with the reason, left for you to decide.

Don't blindly trust run #1. A prompt-injected agent logs its exfil host too.
```

```
5/ MIT, TypeScript, one dependency, zero telemetry. The README lists exactly what it can't see (proxy-ignoring binaries, SSH git, DNS tunnelling).

Try the no-login demo and tell me what it misses:
https://github.com/canerinali/egress-tap
```

Tag nobody in tweet 1; reply to the thread later with a Codex-specific screenshot of the TOML output.

### LinkedIn (Türkçe; sigorta + teknoloji kitlesi)

```
Yapay zekâ kodlama ajanlarını (Claude Code, Codex) şirket kod tabanında kullanıyorsanız, güvenlik ekibinizin er ya da geç soracağı soru şu: "Bu ajan hangi sunuculara bağlanıyor?"

Sigortacılıkta müşteri ve poliçe verisiyle çalışan ekipler için bu soru teorik değil. KVKK, denetim ve bilgi güvenliği tarafında "ajan internete serbestçe çıkabiliyor" cevabı kabul edilebilir değil. Ama ağ erişimini tamamen kapatınca da npm install bile çalışmıyor.

Bu arayı kapatmak için açık kaynak küçük bir araç yazdım: egress-tap.

Nasıl çalışıyor:
• Ajanı bir kez yerel, yalnızca gözlem yapan bir proxy arkasında çalıştırıyorsunuz. Hiçbir trafik engellenmiyor, TLS çözülmüyor, sertifika kurulmuyor.
• Her bağlantı kayda geçiyor: hangi sunucu, hangi port, ne kadar veri.
• Sonunda Claude Code veya Codex'e doğrudan yapıştırabileceğiniz, en az yetkili izin listesini (allowlist) üretiyor.
• Veri sızdırma şüphesi taşıyan adresleri (rastgele görünen alt alan adları, IP adresleri, paste/tünel servisleri, alışılmadık portlar) ayrıca işaretliyor ve listeye asla otomatik eklemiyor.

Neyi göremediğini de README'de açıkça yazdım; güvenlik aracında bu dürüstlük bence özellikten önce gelir.

MIT lisanslı, telemetri yok, tek bağımlılık:
https://github.com/canerinali/egress-tap

Kendi ajan kullanım senaryolarınızda denerseniz, kaçırdığı durumları duymak isterim.

#yapayzeka #bilgiguvenligi #sigortateknolojisi #insurtech #acikkaynak #ClaudeCode
```

Post from your personal profile, not a company page.

### dev.to article

**Title:**
```
Your AI coding agent's network allowlist should come from evidence, not guesses
```

**Tags:** `ai`, `security`, `opensource`, `devtools`

**Summary / outline:**

> Claude Code's sandbox and Codex's permission profiles both let you restrict which domains an
> agent may reach, but neither tells you what to put in the list. This post walks through
> egress-tap: run the agent once behind an observe-only HTTP/CONNECT proxy, log every
> `host:port`, and turn the log into a least-privilege allowlist. It covers (1) why the proxy
> never intercepts TLS, (2) the wildcard rule (3+ hosts per base domain, never on shared hosting
> like `github.io`), (3) the exfil heuristics (Shannon entropy >= 3.5 bits/char on 20+ char
> labels, IP literals, paste/tunnel services, odd ports), (4) why the agent's own API hosts are
> excluded, and (5) an honest list of blind spots: proxy-ignoring binaries, SSH git, DNS
> tunnelling, and the "first session may already be compromised" problem. Ends with the
> fake-agent demo so readers can try it in 30 seconds without a login.

Cross-post canonical URL: the dev.to article itself; link to it from r/netsec.

---

## 4. Distribution list

### Awesome lists (all verified 2026-09-27 via GitHub API: exist, not archived, recently active)

| List | Stars | Section to target | How to submit |
|---|---|---|---|
| https://github.com/hesreallyhim/awesome-claude-code | ~54.7k | `## Security` | **Only via the web UI issue form** (CONTRIBUTING warns PRs/other formats can get you restricted). The maintainer says to get users first; submit after ~50 stars. |
| https://github.com/jqueryscript/awesome-claude-code | ~0.5k | `Tools & Utilities` | PR to README.md |
| https://github.com/RoggeOhta/awesome-codex-cli | ~0.5k | `Model Providers & Proxies` or `CI/CD & Automation` | Issue or PR (per its CONTRIBUTING) |
| https://github.com/ottosulin/awesome-ai-security | ~1.5k | `Defense & Security Controls > Agent Runtime Security & Sandboxing` | PR |
| https://github.com/scadastrangelove/awesome-ai-security-tools | ~1.6k | `AI Agent & Coding-Agent Security > Runtime Protection & Enforcement` (or `Scanners & Auditors`) | PR, following its "Entry Format" section |

Suggested one-line entry: `[egress-tap](https://github.com/canerinali/egress-tap) - Records every host a coding agent contacts through an observe-only proxy and emits a least-privilege Claude Code / Codex network allowlist, flagging exfil-looking hosts.`

### Related open issues and discussions (verified open via `gh search issues`, 2026-09-27)

Rule: only comment where egress-tap genuinely helps the person, disclose that you wrote it, one
comment per thread, no comments on pure bug reports where it would be noise.

**anthropics/claude-code**
- https://github.com/anthropics/claude-code/issues/94306 - [FEATURE] Sandbox network: let the user decide on hosts outside the allowlist in auto mode. Best fit: egress-tap produces the list up front.
- https://github.com/anthropics/claude-code/issues/89616 - extend network egress allowlist for a scheduled Claude Code cloud environment. Fit: "how do I know what to add".
- https://github.com/anthropics/claude-code/issues/88553 - Sandbox network egress allowlist not consistently enforced. Read only; relevant context for the HN comment, do not advertise there.
- https://github.com/anthropics/claude-code/issues/89165 - allowedDomains not enforced for HTTPS CONNECT tunneling. Read only (bug report).

**openai/codex**
- https://github.com/openai/codex/issues/37329 - network_proxy docs do not explain dynamic listener ports or clients that ignore HTTPS_PROXY. Good fit: egress-tap's README documents the same blind spots; a comment sharing that list is useful on its own.
- https://github.com/openai/codex/issues/35243 - Project network allowlist changes are silently ignored by the active task. Read only.

**anthropics/sandbox-runtime** (the library behind Claude Code's sandbox; egress-tap's v0.2 audit mode builds on it)
- https://github.com/anthropics/sandbox-runtime/issues/273 - Allow overriding proxy deny response for blocked network requests. Fit: discussing how users learn which hosts were denied.
- https://github.com/anthropics/sandbox-runtime/issues/468 - Support path-prefix for allowedDomains entries. Read only; useful for the roadmap.
- https://github.com/anthropics/sandbox-runtime/issues/253 - Allow disabling network isolation while preserving filesystem sandboxing. Fit: that is exactly the "observe network with sandbox off" workflow.

---

## 5. GitHub topics

Topics: claude-code, codex, ai-agents, network-security, allowlist, sandbox

Set with: `gh repo edit canerinali/egress-tap --add-topic claude-code,codex,ai-agents,network-security,allowlist,sandbox`

---

## 6. Timing

All times Europe/Istanbul (TRT, UTC+3); US Eastern is 7 hours behind.

| Date | Channel | Time | Notes |
|---|---|---|---|
| **Mon 2026-09-28** | Prep, no posting | any | Add `prepare` script, push repo public, set topics, `npm publish`, record GIF, uncomment it in README, cut a `v0.1.0` release. Verify `npx egress-tap --help` from a clean machine/dir. |
| **Tue 2026-09-29** | **Show HN** | 15:00 TRT (08:00 ET) | Post title + URL, then the first comment immediately. Stay online until ~23:00 TRT to answer every comment. |
| Tue 2026-09-29 | X thread | 17:00 TRT (10:00 ET) | Link to HN thread in a reply only if it is on the front page. |
| **Wed 2026-09-30** | r/ClaudeCode | 16:00 TRT (09:00 ET) | Answer comments for the first 2 hours. |
| **Thu 2026-10-01** | r/ClaudeAI | 16:00 TRT (09:00 ET) | |
| Thu 2026-10-01 | LinkedIn (TR) | 09:00 TRT | Turkish business-hours audience. |
| Fri 2026-10-02 | Awesome-list PRs: jqueryscript, RoggeOhta, ottosulin, scadastrangelove | any | Small lists first; they don't need traction. |
| Fri 2026-10-02 | Issue comments (only the "good fit" ones above) | any | One comment each, disclose authorship. |
| **Mon 2026-10-05** | dev.to article | 16:00 TRT (09:00 ET) | Include the GIF and the "what it can't see" section. |
| **Tue 2026-10-06** | r/netsec (link to the dev.to article) | 16:00 TRT (09:00 ET) | |
| When >= 50 stars | hesreallyhim/awesome-claude-code issue form | any | Per the maintainer's guidance. |
| Wed 2026-10-07 / Thu 2026-10-08 | Show HN second chance (only if the 09-29 post got < 5 points and no discussion) | 15:00 TRT | HN allows a repost of a Show HN that got no traction; change nothing but the timing. |

---

## 7. Post-launch checklist (for you)

1. [x] Add `"prepare": "npm run build"` to `package.json` scripts (needed for `npm i -g github:canerinali/egress-tap`; see the note at the top).
2. [x] Create and push the repo: `gh repo create canerinali/egress-tap --public --source . --push` (run it yourself).
3. [x] Set topics: `gh repo edit canerinali/egress-tap --add-topic claude-code,codex,ai-agents,network-security,allowlist,sandbox`
4. [x] Record the demo GIF: done 2026-09-29 with `python3 demo/make-gif.py` (vhs alternative: `vhs demo/demo.tape`); shown in README.md.
5. [x] Publish to npm: `npm login && npm publish --access public` (the `prepack` hook builds `dist/`). Check with `npm pack --dry-run` first: the tarball must contain `dist/cli.js`.
6. [x] Smoke-test from an empty directory: `npx egress-tap@latest --help` and `npx egress-tap -- curl -sI https://example.com && npx egress-tap emit`.
7. [x] Add real badges (npm, CI, license, node, release) at `<!-- badges -->` (npm version, CI, license).
8. [ ] First share: **Show HN on Tue 2026-09-29, 15:00 TRT (08:00 ET)**, then follow section 6.
