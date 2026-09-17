# Changelog

Notable changes to lean-browser. This project tracks the versions of the two
tools it drives rather than keeping a version of its own, and the versions below
are the ones the skill and its scripts pin or expect.

- `oc`, rungs 1 and 2: pinned to `0.5.4`
- `agent-browser`, rungs 3 and 4: any recent release, 0.32.4 verified here

## Unreleased

### Added

- The `lean-browser` skill, with the four rung escalation ladder and the two
  signals that mean a page was never read: `oc` exiting `2` while printing a
  title, and `agent-browser read` reporting success with empty content.
- `skills/lean-browser/scripts/lean-fetch`, which runs the whole ladder in one
  call. Bash and PowerShell entry points forward to a shared Node implementation,
  so the platforms cannot drift apart. Content goes to stdout, the rung log to
  stderr.
- `--check`, which reports which tools are installed, and `--self-test`, which
  runs offline checks on the decision logic. 17 assertions, no network.
- An MCP server in `mcp/`, exposing `lean_fetch`, `lean_search`, `lean_links`, and
  `lean_check`. This is the path that gives Claude Desktop the browser rungs,
  since an uploaded skill runs in Anthropic's container rather than on your
  machine.
- Reference notes for the `oc` command surface, the browser fallbacks, the
  measured costs, and a worked example with the real output of every rung.
- `AGENTS.md`, which carries a paste-able version of the ladder for agents that
  have no skill system, and the rules for working on this repository.
- Claude Code plugin and marketplace manifests, and Codex `agents/openai.yaml`
  metadata with a default prompt.

### Changed

- The wrapper scripts live inside the skill folder rather than at the repository
  root, so a copy install, a ZIP upload, and `npx skills add` all carry them.
- SKILL.md links its references relative to the skill folder, which is what an
  installed copy resolves.
- Search tools pass a larger budget, and unwrap the DuckDuckGo and Bing redirect
  wrappers so a result URL is a citation rather than a tracking link.

### Known Limits

- No automated coverage for the network rungs. They depend on live sites, so
  they stay manual.
- The PowerShell entry points are untested. No PowerShell was available on the
  machine where this was built, which is why the ladder logic sits in one Node
  file and the `.ps1` files only forward arguments.
- `oc` has no JavaScript rendering, so a client-rendered page always spends two
  rungs before reaching the browser.
