# Troubleshooting

Every entry here came from testing this skill, not from reading about it. If
something is failing in a way that is not listed, the signal is usually an exit
code, so check that first.

## Reads That Look Like Success But Are Not

**Symptom:** you have a page title and nothing else.

`oc` prints the title to stdout, writes its complaint to stderr, and exits `2`.
Whatever reads stdout will look like it worked. Check the exit code:

```bash
oc open <url> --json    # look for "empty": true
```

Never retry the same URL unchanged. The verdict will not change. Move down a
rung, or report that the page could not be read.

**Symptom:** `agent-browser read` reports success and returns nothing.

Its JSON has `success: true` with `data.content` empty on a page that needs a
browser. Check `data.content` for a non-empty string, not the success flag.

## `oc` Is Not The Tool You Expected

**Symptom:** `oc` opens a TUI, hangs, or complains about flags that `only-cli/oc`
does not have.

`oc` is a two letter name and other tools use it. On my own machine `oc` resolved
to a shell script that launched a different program entirely, which is why every
command in this skill uses the pinned form:

```bash
npx --yes @only-cli/oc@0.5.4 <command>
```

To check what you have:

```bash
command -v oc            # where does it point
npx --yes @only-cli/oc@0.5.4 sites   # exits 0 if the real one answers
```

`scripts/lean-fetch.sh --check` reports this for you.

## The Browser Rung Returns An Empty Page

**Symptom:** `agent-browser` reads a page you know has content, and gets nothing.
It works the first time and fails afterwards.

That is the warm daemon problem. `open` returns before a client-rendered page has
drawn, and a cold start hides it because launching Chrome takes long enough. Wait
for the load event, then read:

```
agent-browser open <url>
agent-browser wait --load load
agent-browser read
```

`scripts/lean-fetch.sh` does this, and retries up to three times before giving
up. If you see "page not ready, waiting" three times, the page is probably
showing a consent wall or a bot challenge rather than being slow.

## Search Failures

**Symptom:** `oc ddg search` exits 2 with a challenge page.

DuckDuckGo challenges automated clients. Switch engines or take that one page to
rung 4:

```bash
oc bing search "your query" --budget 1200
```

**Symptom:** search returns navigation and no results.

The budget ran out before the results did. Result pages carry a lot of chrome
above the first result; on Bing the results do not start until around block 15.
The default of 1000 covers DuckDuckGo; Bing needs `--budget 1200`.

**Symptom:** every result href points at the search engine.

A raw render keeps the engine's redirect wrapper. The wrapper script and the MCP
search tool unwrap the DuckDuckGo and Bing shapes. If you are running `oc`
directly, `oc do <n>` follows a result to its destination without you handling
the URL.

## Rate Limits And Refusals

**Symptom:** 429 from Reddit, or refusals after a burst of calls.

Reddit meters anonymous readers tightly. A second request inside thirty seconds
has come back 429 in testing, and a burst takes minutes to clear. Use the
shortcuts that read feeds (`oc reddit sub <name>`, `oc reddit post <id>`) and
space them out.

**Symptom:** `blocked: private or internal URL`.

`oc` refuses private addresses by design, and a host that does not resolve
locally while a proxy is set is refused too, because the proxy would resolve it
on a network `oc` cannot see. This will not succeed on retry. Report it.

## Bot Challenges

**Symptom:** every rung returns a wall: "Just a moment...", "Performing security
verification", or a Turnstile checkbox.

That is Cloudflare or a sibling, and it is not a bug in the ladder. `oc` exits 2
because a transport fingerprint is all it has and the challenge wants
JavaScript. Rung 4 is a real Chrome and can sometimes run the challenge, but
upstream issue 506 reports that stealth plugins, headed mode, custom headers,
and automation launch flags all fail against advanced Cloudflare.

Before you spend a browser launch, try the site's feed. Stack Overflow challenges
every question page and answers `/feeds`, and `oc` converts a feed to the same
readable shape as a page. `oc sites` lists the shortcuts that already know these
side doors.

If the wall holds, report it as a wall. Do not report the challenge text as the
article, and do not retry the same URL. More in [gated-pages.md](gated-pages.md).

## Proxies And Logins

**Symptom:** the cheap rungs fail while the browser rung works, or the reverse,
after you set a proxy.

`oc` reads `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY`, and refuses anything that
is not an HTTP or HTTPS proxy, so a `socks5://` value leaves the cheap rungs
unable to fetch. `agent-browser` reads those same variables, prefers
`AGENT_BROWSER_PROXY` when it is set, and also accepts `ALL_PROXY` for SOCKS.
Check both before you conclude the proxy is broken.

**Symptom:** an authenticated page returns a login form or a 403.

The cheap rungs do not share your browser's cookie jar. Seed it with
`oc login --cookie - --domain example.com`, piping the header in through stdin
rather than passing it as an argument. The full walkthrough is in
[gated-pages.md](gated-pages.md).

## Environment Warnings

**Symptom:** `npm warn EBADENGINE` mentioning Node 20.19 or newer, while
everything still works.

A transitive dependency of `oc` wants a newer Node than the package requires. On
Node 20.16 I saw the warning on every `npx` call and every command still worked.
Upgrade Node if you want the warning gone; otherwise ignore it.

**Symptom:** the installed `agent-browser` is older than the published one.

Version drift is easy to miss, since the README documents the current release and
your binary may lag it. Compare:

```bash
agent-browser --version
npm view agent-browser version
```

A missing flag usually means an old binary. `agent-browser upgrade` is aware of
how it was installed. I hit this while building: the machine had 0.32.4 while the
published version was 0.38.1, so a flag from the docs was not present.

**Symptom:** the browser rung cannot launch.

```bash
agent-browser install     # downloads Chrome for Testing
agent-browser doctor      # diagnose the install, clean stale daemon files
```

## Windows

The PowerShell entry points are untested. There was no PowerShell on the machine
where this was built, which is part of why all the ladder logic lives in
`scripts/lean-fetch.mjs` and the `.ps1` files only forward arguments. If
PowerShell mangles an argument that starts with `--`, call the shared entry point
directly:

```powershell
node scripts/lean-fetch.mjs --check
```

`lean-fetch.mjs` calls `npx.cmd` and `agent-browser.cmd` on Windows and never
goes through a shell, so a URL with an ampersand needs no quoting.

## Claude Desktop Reads Nothing Through The Browser Rungs

That is expected, and it is not a bug in this skill. An uploaded skill runs in
Anthropic's code execution container, which is not your machine, so there is no
Chrome for it to drive. Use the MCP server in `mcp/` as a local connector
instead. It runs on your machine and has the whole ladder.
