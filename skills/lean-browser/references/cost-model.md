# What The Ladder Costs

Two sources here. Numbers I measured while building this, and numbers `oc`
publishes in its own benchmarks. Both are per page unless stated otherwise, and
both are orders of magnitude rather than precise counts, because the same page
renders differently depending on its markup.

## Measured Here

| Page | Tool | Result |
| --- | --- | --- |
| `example.com` | `oc open` | about 40 tokens, readable |
| `crates.io/crates/serde` | `oc open` | nothing readable, exit 2 |
| `crates.io/crates/serde` | `oc raw` | still nothing, just the title |
| `crates.io/crates/serde` | `agent-browser read` (no browser) | `success: true`, empty content |
| `crates.io/crates/serde` | `agent-browser open` then `read` | 3,068 chars of prose, complete |
| `crates.io/crates/serde` | `agent-browser open` then `snapshot -i -c --urls` | 5,778 chars of element tree |

Same page, first rung versus last: roughly 40 tokens against roughly 1,400. The
page decides which rung you can use, and only the browser reads it at all.

That gap is also why the script defaults to `read` rather than `snapshot`: prose
is cheaper and more useful for research, and the element tree is there behind
`--links` for when you need the URL behind a link.

## Published By oc

From [only-cli/oc](https://github.com/only-cli/oc) and its
[benchmarks](https://github.com/only-cli/benchmarks), measured across fifteen
real pages:

| Method | Tokens for 15 pages |
| --- | --- |
| `oc open` | 9,913 |
| Jina Reader | 145,679 |
| Playwright MCP accessibility snapshots | 535,908 |
| Raw HTML fetch | 1,119,003 |

That is 118 times fewer tokens than raw HTML on the fourteen pages both tools
could read, and the budget keeps a heavy page near 500 tokens: YouTube's watch
page is 363,516 tokens of raw HTML and 688 through `oc`.

Their whole task benchmarks are closer together than the per page numbers, and
worth knowing before you expect the ladder to cut your bill by a hundred times.
Across five Wikipedia lookups, `oc` cost $0.23 against $0.45 for a built-in web
search, both fully correct. Across twelve dependency lookups, `oc` cost $0.63
against $1.22. The per task saving is real but it is tens of percent, not orders
of magnitude, because the agent's own prompt dominates the total.

## What This Means In Practice

- One wasted browser launch costs more than a dozen `oc` calls. Escalate
  deliberately, not defensively.
- `raw` is about ten times the first render. Use `find` and `read <n>` instead,
  and only reach for `raw` when you genuinely need the whole page.
- A page you never fetch is free. If a snippet already answered the question,
  write the answer down and move on.
- The budget is a target, not a cap, so a page slightly over 500 tokens prints
  whole. Setting `--budget` very low costs you a second call, which is worse.
