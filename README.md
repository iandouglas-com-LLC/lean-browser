# lean-browser

A web research skill for coding agents. It reads a page with a cheap
command-line fetcher first and only pays for a real browser when a page truly
needs one.

## This Skill Stands On Two Other Projects

lean-browser is a mash-up. It is worth being blunt about what came from where,
because almost all of the hard work belongs to two other teams:

| Project | What it contributes | License |
| --- | --- | --- |
| [**only-cli/oc**](https://github.com/only-cli/oc) | Turns any page into a compact, numbered terminal view in a few hundred tokens. Handles static pages, XML feeds, JSON APIs, and tuned shortcuts for docs sites | MIT |
| [**vercel-labs/agent-browser**](https://github.com/vercel-labs/agent-browser) | Browser automation CLI for agents. Fast native Rust, drives a real Chrome over CDP, and reads anything JavaScript renders | Apache-2.0 |

lean-browser ships **no code from either project**. It installs neither. It is a
thin orchestrator: a written-down answer to "which of these two do I reach for,
in what order, and with what flags", plus small wrappers so an agent does not
have to work that out from scratch on every task.

Both tools are good. The interesting part is that they fail in opposite
directions, and that is the whole reason this skill exists.

## Table of Contents

- [The Problem: You Pay For The Whole Page](#the-problem-you-pay-for-the-whole-page)
- [The Ladder](#the-ladder)
- [The Two Traps That Make This Worth Writing Down](#the-two-traps-that-make-this-worth-writing-down)
- [Install The Two CLIs](#install-the-two-clis)
- [Install The Skill](#install-the-skill)
- [Test It](#test-it)
- [The Wrapper Script](#the-wrapper-script)
- [What Each Rung Costs](#what-each-rung-costs)
- [Trade-offs](#trade-offs)
- [Reference and Further Reading](#reference-and-further-reading)
- [License](#license)

## The Problem: You Pay For The Whole Page

Ask an agent to look something up and it will usually fetch the page and pour
the markup into its context. That markup is mostly navigation, footers, ad
slots, and script tags.

oc's own benchmarks measured it across fifteen real pages. Raw HTML came to
1,119,003 tokens. The same fifteen pages through `oc open` came to 9,913. A
Playwright accessibility snapshot came to 535,908. The skill you are reading
does not beat those numbers. It just points at them and then gets out of the way.

Here is the same point from my own testing while building this, on two pages:

| Page | Tool | Roughly |
| --- | --- | --- |
| `example.com` | `oc open` | 40 tokens |
| `crates.io/crates/serde` | `oc open` | fails, no readable content, exit code 2 |
| `crates.io/crates/serde` | `agent-browser snapshot -i -c --urls` | 1,200 tokens |

So the cheap tool is 30 times cheaper, and it cannot read the second page at
all. The capable tool reads everything, and you pay for it on every page it
touches, including the easy ones. Neither tool is wrong. Using one of them for
everything is.

## The Ladder

Try the cheap rung. Escalate only on the specific signal that says you must.
This is the whole skill, and everything else here is supporting detail.

| Rung | Command | Escalate when |
| --- | --- | --- |
| 1 | `oc <shortcut>` for a known site, else `oc open <url>` | Exit code 2 |
| 2 | `oc raw <url>` | Still only a title, no body |
| 3 | `agent-browser read <url>` (does not launch Chrome) | `content` comes back empty |
| 4 | `agent-browser open <url>` then `agent-browser read` | Working |

Rungs 1 and 2 cost a few hundred tokens. Rung 3 launches no browser but still
does a plain HTTP fetch, so it does not rescue JavaScript-only pages; it is
there because it occasionally reads the markdown a site publishes alongside the
page. Rung 4 is the real browser, and it is the only rung that reads content
JavaScript produces. Read the rendered page there rather than the element tree,
and wait for the load event first, or a warm browser will hand you an empty
page.

One rule that saves more than any rung: **do not refetch what a citation already
answered.** If a search result snippet carries the fact, write it down and move
on. The cheapest page is the one you never open.

If the task needs clicking, typing, logging in, uploading, or a screenshot, skip
straight to rung 4. oc is read-only by design, and its `fill` and `submit`
commands are not implemented yet.

## The Two Traps That Make This Worth Writing Down

Most of the value in this skill is in these two quirks. An agent that does not
know about them will silently think it succeeded, and then invent an answer.

**Trap one: oc exits 2 but still prints a title.** When oc cannot read a page it
writes an explanation to stderr, exits with code 2, and *still prints the page
title to stdout*. I confirmed this on `crates.io/crates/serde`:

```
$ oc open https://crates.io/crates/serde
# crates.io: Rust Package Registry
actions: find <query> | read <n> | raw
oc: no readable content at https://crates.io/crates/serde (no text on the whole
page), so it is JavaScript-only, gated, or challenged; 'oc raw' has the page's
markdown if there is any, otherwise this one needs a browser
```

An agent that reads stdout sees a title and reports success. An agent that
checks the **exit code** sees `2` and moves to the next rung. Exit code 2 means
"oc cannot read this one", which is different from exit code 1, which means an
ordinary failure. Never retry the same URL after exit 2.

**Trap two: agent-browser reports success with nothing in it.** On the same
page, `agent-browser read` answers:

```json
{"success":true,"data":{"content":"","contentType":"text/html; charset=utf-8","status":200}}
```

`success` is `true`. `content` is empty. An agent checking the success flag
concludes it has the page. An agent checking for **non-empty content** escalates
to the real browser. So check `data.content`, not `success`.

## Install The Two CLIs

The skill drives both tools, so decide which rungs you want available.

**oc**, for rungs 1 and 2. Node 20 or newer.

```bash
npm install -g @only-cli/oc
oc open https://example.com
```

No install also works: `npx --yes @only-cli/oc@0.5.4 open <url>` runs it
directly. The skill and the wrapper scripts use that pinned form by default,
which is deliberate. See
[Troubleshooting](skills/lean-browser/references/troubleshooting.md) for why.

**agent-browser**, for rungs 3 and 4. This one downloads Chrome the first time.

```bash
npm install -g agent-browser
agent-browser install
```

Or `brew install agent-browser` on macOS. If you skip this, rungs 3 and 4 are
unavailable and the skill will tell you so rather than failing silently.

## Install The Skill

A skill is a folder with a `SKILL.md` in it. Four of the five tools below read
skills from the same two global directories, so one copy plus one symlink covers
all of them.

```bash
git clone https://github.com/iandouglas-com-LLC/lean-browser.git
mkdir -p ~/.agents/skills ~/.claude/skills
cp -R lean-browser/skills/lean-browser ~/.agents/skills/
ln -s ~/.agents/skills/lean-browser ~/.claude/skills/lean-browser
```

That one recipe installs for Claude Code, Codex, Zed, and OpenCode. The rest of
this section is the per-tool detail, including the two tools that need something
different.

### Claude Code

Either of these works. The installer is easiest:

```bash
npx --yes skills@latest add iandouglas-com-LLC/lean-browser -g -s lean-browser -a '*'
```

Or install it as a plugin, which also gets you updates through the marketplace:

```
/plugin marketplace add iandouglas-com-LLC/lean-browser
/plugin install lean-browser@lean-browser
```

Claude Code reads personal skills from `~/.claude/skills/<name>/SKILL.md` and
project skills from `.claude/skills/`, so the clone-and-symlink recipe above
works too. The skill declares `allowed-tools` for the commands it runs, which
Claude Code honors, so you should not be prompted for each `oc` call.

### Claude Desktop

Claude Desktop is the odd one out, in two ways that matter.

First, skills there are **uploaded as a ZIP**, not dropped in a directory:

1. Enable **Code execution and file creation** in **Settings > Capabilities**.
2. Zip the skill folder so the folder itself is at the root of the archive:
   ```bash
   cd lean-browser/skills && zip -r ../lean-browser.zip lean-browser
   ```
3. Open **Customize > Skills**, click **+**, then **Create skill**, choose
   **Upload a skill**, and pick the ZIP you just built.
4. Toggle it on in your skills list.

Second, and this is the honest caveat: **an uploaded skill runs in Anthropic's
code execution container, not on your machine.** oc is a Node CLI that makes
HTTP requests, so rungs 1 and 2 can work there. The browser rungs cannot, because
there is no Chrome on your desktop for the container to drive, and no daemon
persisting between calls. Expect `oc` reads and expect the browser rungs to
report themselves as unavailable.

For the full ladder on Claude Desktop, run the [MCP
server](mcp/README.md) from this repo as a custom connector instead. That runs
on your machine, so the whole ladder is available, and Claude Desktop reaches it
through its native connector support. You can install the ZIP as well and let
the skill explain the ladder, but the connector is what actually reaches your
Chrome.

### Codex

Codex reads global skills from `~/.agents/skills/` and repo skills from
`.agents/skills/` in any directory from your working directory up to the repo
root. It follows symlinks, so the clone-and-symlink recipe works.

```bash
npx --yes skills@latest add iandouglas-com-LLC/lean-browser -g -s lean-browser -a codex
```

Invoke it explicitly with `/skills` or by typing `$lean-browser`. Codex matches
skills implicitly from the `description` too, and its frontmatter supports
`agents/openai.yaml`, which this repo ships with a `default_prompt` you can use
as a first test.

Two Codex quirks to know: the initial skill list is budgeted at 2 percent of the
context window, so descriptions get shortened first when you have many skills
installed. This skill's description is written to survive that, with the trigger
words up front.

### Zed

Zed reads global skills from `~/.agents/skills/` and project skills from
`.agents/skills/`. Skills must be a direct child of that directory, so no
nesting. The clone-and-symlink recipe covers it.

Then invoke it from the message editor with `/lean-browser`, or mention it with
`@skill`. Zed shows a catalog of installed skills to the agent, which loads one
when a task matches its description.

Zed prompts for permission the first time a skill or its commands run. You can
allow this skill permanently under **AI > Skills** and in the **Tool
Permissions** settings so it stops asking. Note that Zed does not read
`allowed-tools` yet, so the pre-approved command list in `SKILL.md` has no
effect there and a `Bash` prompt is normal.

### OpenCode

OpenCode searches more locations than the others, any of which work:

- `.opencode/skills/<name>/SKILL.md` or `~/.config/opencode/skills/`
- `.claude/skills/<name>/SKILL.md` or `~/.claude/skills/`
- `.agents/skills/<name>/SKILL.md` or `~/.agents/skills/`

The clone-and-symlink recipe works. To control permissions, add a block to
`opencode.json`:

```json
{
  "permission": {
    "skill": {
      "lean-browser": "allow"
    }
  }
}
```

### Any Other Agent

For an agent with no skill system, paste the block from [AGENTS.md](AGENTS.md)
into your instructions file. That block is also the closest thing to a hook into
the upstream agent-browser skill: it tells any agent to try `oc` before
launching Chrome, which is the one thing the two skills cannot agree on by
themselves.

## Test It

The prompt below exercises the ladder end to end, because it mixes a page oc can
read with a page it cannot.

```
Research the Rust crate serde for me. I want its current version, its license,
who maintains it, and what the crate actually does. Use the lean-browser skill.
Tell me which tool read each page and cite the URLs.
```

What a good run looks like:

- It reaches for `oc` first, not a browser.
- `crates.io` comes back with exit code 2, and it says so instead of pretending.
- It escalates to `agent-browser`, gets `serde v1.0.229`, the MIT and Apache-2.0
  licenses, and the maintainer from the rendered page.
- It ends with a short summary and the URLs it used.

A bad run fetches the raw HTML of both pages, or reports the crates.io title as
if it were the answer.

Something simpler, to check the trigger fires at all:

```
Look up the current recommended way to configure HTTP proxies in Go and cite
the official page.
```

## The Wrapper Script

`skills/lean-browser/scripts/lean-fetch.sh` runs the whole ladder in a single
call and tells you which rung produced the result. It lives inside the skill
folder, so it arrives with any of the install paths above.

```bash
./skills/lean-browser/scripts/lean-fetch.sh https://example.com
./skills/lean-browser/scripts/lean-fetch.sh wiki article Eiffel Tower --budget 300
./skills/lean-browser/scripts/lean-fetch.sh https://crates.io/crates/serde --links
./skills/lean-browser/scripts/lean-fetch.sh --check
```

Content goes to stdout and the rung log goes to stderr, so you can capture just
the page. On Windows use `scripts/lean-fetch.ps1`, or the `.sh` under Git Bash.

The ladder itself lives in `lean-fetch.mjs`, with thin bash and PowerShell entry
points around it, so macOS, Linux, and Windows cannot drift apart. Node 20 or
newer, which `oc` needs anyway.

## What Each Rung Costs

Order of magnitude, per page, measured while building this and consistent with
oc's published benchmarks:

| Rung | Cost | Reads JavaScript |
| --- | --- | --- |
| `oc open` | 40 to 1,000 tokens | No |
| `oc raw` | roughly 10x `oc open` | No |
| `agent-browser read` | one HTTP fetch, no browser launch | No |
| `agent-browser read` on the rendered tab | roughly 700 tokens of prose | Yes |
| `agent-browser snapshot -i -c --urls` | roughly 1,400 tokens of element tree | Yes |

The spread between the top and bottom rung is the reason to bother. It is also
the reason not to be clever about it: one wasted browser launch costs more than a
dozen `oc` calls.

## Trade-offs

**What this is good at.** Research and lookups where you need the content of a
page: documentation, release notes, issue threads, changelogs, an API reference,
a fact you need to cite. Broad trigger, cheap failure mode. Worst case it spends
1,000 tokens and falls through to the next rung.

**What it is not.** It is not a testing tool, and it does not replace
agent-browser for interactive work. Anything that clicks, types, logs in,
uploads, or screenshots belongs to agent-browser directly. lean-browser defers
that on purpose, and its description says so, so the two skills should not fight
over the same task.

**Where it will disappoint you.** oc has no JavaScript rendering, so pages that
render entirely client side always burn two rungs before the browser. Search
engines challenge automated clients, so `oc ddg search` will occasionally exit 2
and need the browser rung or a different engine. Sites that meter anonymous
readers, Reddit most of all, will return 429 if you move fast; space those calls
out. And a page behind a login needs cookies seeded with `oc login` or a real
browser session, neither of which this skill can do for you.

**The cost you do not see.** Rung 4 leaves a Chrome process and a daemon behind.
They idle out after an hour, but if you are scripting this, call
`agent-browser close` when you are done.

## Reference and Further Reading

- [references/oc-cheatsheet.md](skills/lean-browser/references/oc-cheatsheet.md)
  for the oc command surface, shortcuts, exit codes, and sessions
- [references/agent-browser-fallback.md](skills/lean-browser/references/agent-browser-fallback.md)
  for the browser rungs, output limits, and cleanup
- [references/troubleshooting.md](skills/lean-browser/references/troubleshooting.md)
  for the collisions and warnings you will actually hit
- [references/cost-model.md](skills/lean-browser/references/cost-model.md) for
  the measured numbers behind the ladder
- [AGENTS.md](AGENTS.md), a block to paste into another agent's instructions
  file when it has no skill system of its own
- [mcp/README.md](mcp/README.md), for running the ladder as MCP tools in Claude
  Desktop, Claude Code, or Zed
- [only-cli/oc](https://github.com/only-cli/oc) and its
  [benchmarks](https://github.com/only-cli/benchmarks)
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) and
  [agent-browser.dev](https://agent-browser.dev)
- [Agent Skills specification](https://agentskills.io/specification), the format
  these tools all follow

## License

MIT. See [LICENSE](LICENSE). Neither upstream project is bundled or relicensed:
oc is MIT and agent-browser is Apache-2.0, and you install them yourself.
