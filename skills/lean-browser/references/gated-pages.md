# Gated Pages, Proxies, And Auth

Some pages fight back. This note covers what the cheap rungs already do about
that, where the hard wall is, and how to run the whole ladder through a proxy or
a login.

## What The Cheap Rungs Already Handle

More than you would guess, because `oc` impersonates a browser at the transport
layer rather than the JavaScript layer. It fetches through libcurl-impersonate,
presenting a real Chrome TLS and HTTP/2 fingerprint, and retries with a Firefox
one for hosts whose edge refuses Chrome. Reddit is one of those, and `oc` knows
it by name. A plain `fetch` is the last resort because it cannot fake a TLS
fingerprint at all.

`oc` also reads the server-rendered thing a gated site leaves open. Feeds are the
big one: any URL answering with Atom or RSS is converted to the same readable
shape as a page, so a site that challenges every HTML view may still be readable
through its feed. Stack Overflow challenges its question pages and answers
`/feeds`. Reddit's front pages, subreddits, and posts are read through
`www.reddit.com` feeds rather than the HTML, which since 2026 sends logged-out
readers to a login page.

That is also why about two dozen shortcuts exist. Several are gated or JS-only
sites with a working side door: `oc so`, `oc reddit`, `oc learn`, and the docs
shortcuts for MDN, Node, Python, Ruby, and PHP all ride something other than the
page's own HTML. Reach for a shortcut before you reach for a browser.

The known limit, in oc's own words: a page that only renders with JavaScript,
sits behind a hard bot challenge, and exposes no feed is out of reach. That is
what the browser rungs are for.

## Bot Challenges

Cloudflare, DataDome, and PerimeterX are the usual suspects, and they are a
moving target that neither tool claims to beat.

- `oc` reports the wall instead of pretending. A challenged or JS-only page
  exits 2 with one line on stderr. There is no stealth switch to flip, because
  the transport fingerprint is the defense and it is already on.
- `agent-browser` drives a real Chrome, which is the opposite trade. It can run
  the challenge's JavaScript, and it is also easier to fingerprint. Upstream
  issue [#506](https://github.com/vercel-labs/agent-browser/issues/506) collects
  the reports, and every workaround listed there (automation launch flags, headed
  mode, a stealth plugin, custom headers) is reported failing against advanced
  Cloudflare.
- Stealth mode as an environment variable is upstream issue
  [#120](https://github.com/vercel-labs/agent-browser/issues/120), still open.

So when you hit a Turnstile interstitial, the honest order is: try a feed or a
shortcut, try the browser rung once, and then say the page is challenged. Do not
spend four rungs on a wall, and never report the challenge text as the answer.

If you want a real stealth story for the browser rung,
[stealth-chrome-devtools-mcp](https://github.com/DevinoSolutions/stealth-chrome-devtools-mcp)
is a separate MCP server built on nodriver, with profile cloning for logins and
anti-detection argument filtering. Two things to weigh first: it is AGPL-3.0
while this repo is MIT, and it is deliberately large, 94 tools against this
skill's four. Nothing here vendors it or depends on it.

## Proxies

The good news is that one environment variable covers the whole ladder.
`agent-browser` falls back to the standard variables when its own is unset, so
this reaches both tools at once:

```bash
export HTTPS_PROXY=http://user:pass@proxy.example:8080
export NO_PROXY=localhost,internal.example
```

`oc` reads `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY`, upper or lower case, and
picks `HTTPS_PROXY` for an https target. `agent-browser` reads those same three,
plus `ALL_PROXY` for SOCKS, and prefers its own `AGENT_BROWSER_PROXY` when you
set it. To override the ladder for one browser session only:

```bash
agent-browser open https://example.com --proxy http://127.0.0.1:8080
agent-browser open https://example.com --proxy-bypass "localhost,*.internal.com"
```

Four limits worth knowing before you debug a proxy:

- `oc` honors HTTP and HTTPS proxies only. A `socks5://` value is refused with a
  message saying so. Chrome can use a SOCKS proxy, so a SOCKS-only setup leaves
  the cheap rungs unable to fetch.
- `oc` still checks the target against its private-address rules when a proxy is
  set, and fails closed. If the target hostname does not resolve on your local
  DNS, which is normal for internal names behind a corporate proxy, `oc` refuses
  rather than handing the name to the proxy. The proxy host itself is trusted,
  since you configured it, and corporate proxies commonly live on loopback or
  RFC 1918 addresses.
- A proxy that terminates TLS with its own certificate needs the browser rung to
  trust it. `agent-browser` takes `--ca-cert <path>` or a `caCert` config entry,
  documented for a locally launched Chromium on Linux. `--ignore-https-errors`
  is the blunt alternative and turns off certificate checking for the session,
  which you should treat as a real trade rather than a shortcut.
- Redirect hops are checked on the way out even when the first request went
  through a proxy.

## Auth And Cookies

The cheap rungs do not share your browser's cookie jar. `oc` is an HTTP client
with its own jar, kept per session, so an authenticated page is a wall until you
seed it:

```bash
printf '%s' "session=abc123; other=value" | oc login --cookie - --domain example.com
oc open https://example.com/account
oc logout
```

Pipe the header in with `-` instead of passing it as an argument. A `Cookie`
header is a live credential, and argv is visible to every process on the machine.
`oc` strips a leading `Cookie:` label, so pasting from devtools works. The seeded
cookies live in a separate file from page state, default to a one hour lifetime
that `--expires` changes, and are sent only to that domain. `--allow-http` exists
for the rare site that really is http-only; you should not need it. `oc logout`
forgets that session's cookies and its saved page together.

For the browser rungs, credentials have a first-class home:

```bash
agent-browser auth save myapp --url https://example.com/login --username me --password-stdin
agent-browser auth login myapp
```

`--password-stdin` keeps the password out of argv the same way. If your secrets
live in a vault, the `credential.read` plugin capability lets a provider resolve
them at login time with `--credential-provider` instead of storing them here.

Neither path means the agent can log in anywhere. You are handing it one session
for one site, on purpose. Prefer a scoped token over a full session cookie when
the site offers one, and log out when the task is done.

## When Nothing Works

Say so, and say why. "Cloudflare is challenging this page and the cheap fetch
cannot pass it" is a useful answer. Retrying the same URL, or handing a
challenge page's text to the user as though it were the article, is not. The
second one is worse than failing, because it looks like success.
