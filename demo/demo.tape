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
