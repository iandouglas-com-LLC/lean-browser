# A Worked Example

One research task, start to finish, with the real output from the commands. This
is the pattern to follow. Values are trimmed for length and marked where that
happens.

## The Prompt

```
Research the Rust crate serde for me. I want its current version, its license,
who maintains it, and what the crate actually does. Use the lean-browser skill.
Tell me which tool read each page and cite the URLs.
```

It asks for a page that `oc` can read (the crate's own site is a different page
from its source) and one that it cannot, so the ladder has to do both.

## Rung 1: Try The Cheap Read

```
$ npx --yes @only-cli/oc@0.5.4 open https://crates.io/crates/serde --budget 500
# crates.io: Rust Package Registry
actions: find <query> | read <n> | raw
oc: no readable content at https://crates.io/crates/serde (no text on the whole
page), so it is JavaScript-only, gated, or challenged; 'oc raw' has the page's
markdown if there is any, otherwise this one needs a browser
```

Exit code `2`. Note the trap: a title came back on stdout, so anything reading
only the output would call this a success and report "crates.io: Rust Package
Registry" as the answer to a question about serde.

With `--json` the same verdict is structural, which is what the wrapper reads:

```json
{"url":"https://crates.io/crates/serde","title":"crates.io: Rust Package Registry","blocks":[],"empty":true}
```

## Rung 2: The Page's Own Markdown

```
$ npx --yes @only-cli/oc@0.5.4 raw https://crates.io/crates/serde
# crates.io: Rust Package Registry
```

Nothing. The page ships no markdown, so this rung is spent and the next one is
the browser.

## Rung 3: A Fetch Without A Browser

```
$ agent-browser read https://crates.io/crates/serde --json
{"success":true,"data":{"content":"","contentType":"text/html; charset=utf-8","status":200,"source":"html-fallback"}}
```

`success` is `true` and `content` is empty. The second trap.

## Rung 4: The Real Browser

```
$ agent-browser open https://crates.io/crates/serde
$ agent-browser wait --load load
$ agent-browser read
```

Trimmed:

```
crates.io

# The Rust community's crate registry

Search
Log in with GitHub
Menu

# serde v1.0.229

A generic serialization/deserialization framework

- #no_std
- #serde
- #serialization

- Readme
- Code
- 316 Versions
- Dependencies
...
- David Tolnay
- serde-rs/publish
```

Now we have prose. The version, the one line description, and the maintainer are
all here. The licenses come from the same page's metadata region: **MIT** and
**Apache-2.0**, which is the `MIT OR Apache-2.0` pair.

## What Was Spent

| Rung | Tool | Result |
| --- | --- | --- |
| 1 | `oc open` | exit 2, nothing readable |
| 2 | `oc raw` | title only |
| 3 | `agent-browser read` | `success: true`, empty content |
| 4 | `agent-browser open` + `read` | the answer |

Three cheap rungs failed, and they cost very little between them. That is the
point of ordering them this way: the failures are cheap, and only the page that
needs a browser pays for one.

If the task had instead been "log into crates.io and check my own crate", the
ladder would not be involved at all. That is interactive work, and it belongs to
`agent-browser` from the first move.

## The Report

```
serde is at 1.0.229 and describes itself as a generic serialization and
deserialization framework for Rust. It is dual licensed MIT OR Apache-2.0, and
David Tolnay maintains it.

Which tool read what:
- crates.io/crates/serde could not be read by the cheap CLI (it renders client
  side, and the tool exits 2 on that), so a browser read it.
- The version, license, maintainer, and description above all come from that one
  page.

Sources:
- https://crates.io/crates/serde
```

Short. Sourced. It names the page it could not read cheaply, which is worth
doing when the user is evaluating this skill, and it does not pad the answer with
quoted page text.

## The Same Task Through The Wrapper

`skills/lean-browser/scripts/lean-fetch.sh` runs all four rungs in one call:

```
$ ./skills/lean-browser/scripts/lean-fetch.sh https://crates.io/crates/serde
lean-fetch: rung 1: oc open
lean-fetch: rung 1: nothing readable
lean-fetch: rung 2: oc raw
lean-fetch: rung 2: nothing readable
lean-fetch: rung 3: agent-browser read
lean-fetch: rung 3: agent-browser read found no content
lean-fetch: rung 4: agent-browser open + read
crates.io
...
```

Content on stdout, the rung log on stderr, and the browser closed on the way out.
The MCP tools do the same and append a line naming the rung that produced the
answer.
