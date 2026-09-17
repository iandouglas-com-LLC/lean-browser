#!/usr/bin/env node
// lean-browser ladder runner.
//
// Reads a URL, or any `oc` shortcut, at the lowest cost that works. Tries the
// cheap fetcher first and escalates to a real browser only on the signals that
// say it must.
//
// stdout carries content only. Everything else goes to stderr, so an agent can
// pipe or capture stdout and get the page and nothing else.
//
// Exit codes:
//   0  content was produced
//   2  no rung could read it (a browser may be needed, or the page is empty)
//   1  usage error, or the tools are not installed
//
// No dependencies. Node 20 or newer, which `oc` needs anyway.

import { spawnSync } from "node:child_process";

const OC_VERSION = process.env.LEAN_OC_VERSION || "0.5.4";
const DEFAULT_BUDGET = 1000;
const DEFAULT_MAX_CHARS = 20000;
const DEFAULT_SESSION = "lean-browser";

// On Windows there is no shell here, so call the .cmd shims directly. This
// avoids shell quoting entirely, which matters for URLs with an ampersand.
const IS_WIN = process.platform === "win32";
const NPX = IS_WIN ? "npx.cmd" : "npx";
const AGENT_BROWSER = IS_WIN ? "agent-browser.cmd" : "agent-browser";

function log(msg) {
  process.stderr.write(`lean-fetch: ${msg}\n`);
}

// Offline checks for the parts that decide what happens next: reading oc's
// verdict, unwrapping a search redirect, and rendering blocks. No network, so
// this runs anywhere and can never be flaky.
function selfTest() {
  let passed = 0;
  const failures = [];

  const check = (label, actual, expected) => {
    if (actual === expected) {
      passed += 1;
    } else {
      failures.push(`${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
    }
  };

  // oc's verdict comes from a field, not from stdout.
  const readable = parseOcJson(
    '{"url":"https://example.com","title":"Example Domain","blocks":[{"type":"heading","level":1,"text":"Example Domain"}],"empty":false}',
  );
  check("parses a readable page", readable && readable.empty, false);
  check("reads the title", readable && readable.title, "Example Domain");

  const unreadable = parseOcJson(
    '{"url":"https://crates.io/crates/serde","title":"crates.io","blocks":[],"empty":true}',
  );
  check("spots the empty verdict", unreadable && unreadable.empty, true);
  check("empty page reports no blocks", (unreadable.blocks || []).length, 0);

  check("ignores a line that is not JSON", parseOcJson("oc: no readable content"), null);
  check("tolerates empty output", parseOcJson(""), null);

  // Search results arrive wrapped in the engine's redirect.
  const ddg =
    "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rs%2Fserde%2Flatest%2Fserde%2F&rut=c1672e0";
  check("unwraps a duckduckgo redirect", unwrapRedirect(ddg), "https://docs.rs/serde/latest/serde/");

  const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const bingExternal = `https://www.bing.com/ck/a?!&&p=abc&u=a1${b64url("https://example.com/page")}&ntb=1`;
  check("unwraps a bing redirect", unwrapRedirect(bingExternal), "https://example.com/page");

  // Bing also wraps internal links, which decode to a relative path. Those stay
  // as they arrived, because a relative path is not a citation.
  const bingInternal = `https://www.bing.com/ck/a?!&&u=a1${b64url("/images/search?q=x")}&ntb=1`;
  check("leaves a relative bing target alone", unwrapRedirect(bingInternal), bingInternal);
  check("leaves an ordinary url alone", unwrapRedirect("https://example.com/"), "https://example.com/");
  check("survives an empty href", unwrapRedirect(""), "");
  check("survives no href at all", unwrapRedirect(undefined), undefined);

  // Rendering is what the model actually sees.
  check(
    "renders headings by level",
    renderBlocks({ blocks: [{ type: "heading", level: 2, text: "Install" }] }),
    "## Install",
  );
  check(
    "renders a link with its href",
    renderBlocks({ blocks: [{ type: "link", n: 4, text: "docs", href: "https://example.com/d" }] }),
    "[4] docs -> https://example.com/d",
  );
  check(
    "renders plain text",
    renderBlocks({ blocks: [{ type: "text", text: "hello" }] }),
    "hello",
  );
  check(
    "renders an unknown block type by its text",
    renderBlocks({ blocks: [{ type: "input", n: 9, text: "Search" }] }),
    "[9] Search",
  );
  check("renders an empty page as nothing", renderBlocks({}), "");

  process.stdout.write(`lean-fetch self-test: ${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    process.stdout.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }
  process.exit(0);
}

function fail(msg, code) {
  process.stderr.write(`lean-fetch: ${msg}\n`);
  process.exit(code);
}

// Runs a command and returns { status, stdout, stderr } without ever throwing.
function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) {
    return { status: -1, stdout: "", stderr: String(res.error.message || res.error) };
  }
  return {
    status: res.status === null ? -1 : res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function oc(args) {
  return run(NPX, ["--yes", `@only-cli/oc@${OC_VERSION}`, ...args]);
}

function browser(args) {
  return run(AGENT_BROWSER, args);
}

// oc answers with the verdict in a field, which is more reliable than reading
// stdout: a page it cannot read still prints its title.
function parseOcJson(stdout) {
  const line = stdout.split("\n").find((l) => l.trim().startsWith("{"));
  if (!line) return null;
  try {
    return JSON.parse(line.trim());
  } catch {
    return null;
  }
}

// Search results come back wrapped in the engine's own redirect, which is
// useless to cite. Unwrap the two shapes worth knowing, and leave anything
// unfamiliar exactly as it arrived.
function unwrapRedirect(href) {
  if (!href) return href;
  try {
    const ddg = href.match(/[?&]uddg=([^&]+)/);
    if (ddg && /duckduckgo\.com/.test(href)) {
      return decodeURIComponent(ddg[1]);
    }
    const bing = href.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
    if (bing && /bing\.com/.test(href)) {
      const b64 = bing[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch {
    /* fall through and keep the original */
  }
  return href;
}

function renderBlocks(page) {
  const lines = [];
  for (const block of page.blocks || []) {
    const marker = block.n ? `[${block.n}] ` : "";
    const text = block.text || "";
    if (block.type === "heading") {
      const level = Math.min(Math.max(block.level || 1, 1), 6);
      lines.push(`${"#".repeat(level)} ${text}`.trim());
    } else if (block.type === "link") {
      const href = unwrapRedirect(block.href);
      lines.push(`${marker}${text}${href ? ` -> ${href}` : ""}`.trim());
    } else if (text) {
      lines.push(`${marker}${text}`.trim());
    }
  }
  return lines.join("\n");
}

// Returns { ok, content, url } for one oc rung.
function tryOcRung(label, args) {
  const res = oc([...args, "--json", "--session", SESSION]);
  const page = parseOcJson(res.stdout);

  if (res.status === 2 || (page && page.empty)) {
    log(`${label}: nothing readable`);
    return { ok: false, url: page && page.url };
  }
  if (res.status !== 0) {
    const detail = res.stderr.trim().split("\n").pop() || `exit ${res.status}`;
    log(`${label}: failed (${detail})`);
    return { ok: false, url: page && page.url, hardError: true };
  }
  if (!page) {
    log(`${label}: could not parse output`);
    return { ok: false };
  }

  const content = renderBlocks(page);
  if (!content.trim()) {
    log(`${label}: no text in the response`);
    return { ok: false, url: page.url };
  }
  return { ok: true, content, url: page.url };
}

function tryAgentBrowserRead(url) {
  const res = browser(["read", url, "--json"]);
  if (res.status !== 0) {
    log("rung 3: agent-browser read failed");
    return { ok: false };
  }
  let payload = null;
  try {
    payload = JSON.parse(res.stdout);
  } catch {
    /* fall through */
  }
  // A JavaScript-only page answers success true with empty content, so the
  // content field is the only honest signal.
  const content = payload && payload.data && payload.data.content;
  if (typeof content !== "string" || !content.trim()) {
    log("rung 3: agent-browser read found no content");
    return { ok: false };
  }
  return { ok: true, content };
}

function tryAgentBrowserPage(url, maxChars, keepOpen, wantLinks) {
  const sessionArgs = ["--session", SESSION];
  const opened = browser([...sessionArgs, "open", url]);
  if (opened.status !== 0) {
    log("rung 4: could not launch the browser");
    if (/install/i.test(opened.stderr)) {
      log("run: agent-browser install");
    }
    return { ok: false };
  }

  // A warm daemon makes `open` return before a client-rendered page has drawn
  // anything, so the first read after it comes back empty. Cold starts hide
  // this, which is what makes it worth handling rather than hoping. Wait for
  // the load event, then retry with a short pause before giving up.
  browser([...sessionArgs, "wait", "--load", "load"]);

  const readArgs = (verb) => [...sessionArgs, "--max-output", String(maxChars), ...verb];
  const usable = (res) =>
    res.status === 0 &&
    (res.stdout || "").trim() &&
    !/no interactive elements/i.test(res.stdout);

  let content = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = wantLinks
      ? browser(readArgs(["snapshot", "-i", "-c", "--urls"]))
      : browser(readArgs(["read"]));
    if (usable(res)) {
      content = res.stdout.trim();
      break;
    }
    log(`rung 4: page not ready, waiting (attempt ${attempt + 1})`);
    browser([...sessionArgs, "wait", "800"]);
  }

  // Some pages render controls but no prose. The element tree still beats
  // nothing, so fall back to it before declaring the rung a failure.
  if (!content && !wantLinks) {
    const res = browser(readArgs(["snapshot", "-i", "-c", "--urls"]));
    if (usable(res)) {
      log("rung 4: no prose on the page, returning the element tree instead");
      content = res.stdout.trim();
    }
  }

  if (!keepOpen) {
    browser([...sessionArgs, "close"]);
  }
  if (!content) {
    log("rung 4: the page produced no readable content");
    return { ok: false };
  }
  return { ok: true, content };
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
let SESSION = DEFAULT_SESSION;
let budget = DEFAULT_BUDGET;
let maxChars = DEFAULT_MAX_CHARS;
let keepOpen = false;
let allowBrowser = true;
let wantLinks = false;
let check = false;
let findQuery = null;
const positional = [];

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === "--check") check = true;
  else if (arg === "--self-test") selfTest();
  else if (arg === "--keep-open") keepOpen = true;
  else if (arg === "--links") wantLinks = true;
  else if (arg === "--no-browser") allowBrowser = false;
  else if (arg === "--budget") budget = Number(argv[++i]);
  else if (arg === "--max-chars") maxChars = Number(argv[++i]);
  else if (arg === "--session") SESSION = String(argv[++i]);
  else if (arg === "--find") findQuery = String(argv[++i]);
  else if (arg === "--help" || arg === "-h") {
    process.stdout.write(
      [
        "usage: lean-fetch <url> [options]",
        "       lean-fetch <site> <verb> [args] [options]",
        "",
        "Reads with a cheap CLI fetcher first, escalating to a real browser",
        "only when the page proves it needs one.",
        "",
        "options:",
        "  --budget <tokens>    render target for the cheap rungs (default 1000)",
        "  --find <query>       run `oc find` on the page in hand after reading it",
        "  --max-chars <n>      cap browser output in characters (default 20000)",
        "  --links              return the element tree with link URLs instead of page text",
        "  --session <name>     state name for both tools (default lean-browser)",
        "  --no-browser         stop after the no-browser rungs",
        "  --keep-open          leave the browser running after rung 4",
        "  --check              report which tools are installed, then exit",
        "  --self-test          run offline checks on the decision logic, then exit",
        "",
      ].join("\n"),
    );
    process.exit(0);
  } else {
    positional.push(arg);
  }
}

if (check) {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  process.stdout.write(`node             ${process.versions.node}${nodeMajor >= 20 ? "" : "  (oc wants 20 or newer)"}\n`);
  const npx = run(NPX, ["--version"]);
  process.stdout.write(`npx              ${npx.stdout.trim() || "not found"}\n`);
  const ocCheck = oc(["sites"]);
  process.stdout.write(
    `oc ${OC_VERSION}        ${ocCheck.status === 0 ? "reachable" : "NOT reachable, rungs 1 and 2 unavailable"}\n`,
  );
  const ab = browser(["--version"]);
  process.stdout.write(
    `agent-browser    ${ab.status === 0 && ab.stdout.trim() ? ab.stdout.trim() : "NOT installed, rungs 3 and 4 unavailable"}\n`,
  );
  process.stdout.write("\nIf a tool is missing:\n");
  process.stdout.write("  npm install -g @only-cli/oc\n");
  process.stdout.write("  npm install -g agent-browser && agent-browser install\n");
  process.exit(ocCheck.status === 0 ? 0 : 1);
}

if (positional.length === 0) {
  fail("give me a URL or an oc shortcut. Try --help.", 1);
}

const looksLikeUrl = /^https?:\/\//i.test(positional[0]);

// Rung 1: a shortcut when the first argument is not a URL, else `open`.
const firstArgs = looksLikeUrl
  ? ["open", positional[0], "--budget", String(budget)]
  : [...positional, "--budget", String(budget)];

log(looksLikeUrl ? "rung 1: oc open" : "rung 1: oc shortcut");
let result = tryOcRung("rung 1", firstArgs);
let url = result.url || (looksLikeUrl ? positional[0] : null);

if (result.ok) {
  if (findQuery) {
    const found = oc(["find", findQuery, "--session", SESSION]);
    if (found.status === 0 && found.stdout.trim()) {
      log(`oc find: ${findQuery}`);
      log("read via rung 1");
      process.stdout.write(`${found.stdout.trim()}\n`);
      process.exit(0);
    }
    log("oc find came back empty, printing the page instead");
  }
  log("read via rung 1");
  process.stdout.write(`${result.content}\n`);
  process.exit(0);
}

// Rungs 2 through 4 need a URL. A shortcut that fails still reports the URL it
// resolved to in its JSON, which is how we get one here.
if (!url) {
  fail("rung 1 could not read that, and it did not report a URL to escalate with", 2);
}

// Rung 2: the page's own markdown, when the distilled render came up empty.
log("rung 2: oc raw");
result = tryOcRung("rung 2", ["raw", url]);
if (result.ok) {
  log("read via rung 2");
  process.stdout.write(`${result.content}\n`);
  process.exit(0);
}

if (!allowBrowser) {
  fail(`no cheap rung could read ${url}`, 2);
}

// Rung 3: a plain fetch that does not launch a browser.
log("rung 3: agent-browser read");
result = tryAgentBrowserRead(url);
if (result.ok) {
  log("read via rung 3");
  process.stdout.write(`${result.content}\n`);
  process.exit(0);
}

// Rung 4: the real browser.
log("rung 4: agent-browser open + read");
result = tryAgentBrowserPage(url, maxChars, keepOpen, wantLinks);
if (result.ok) {
  log("read via rung 4");
  process.stdout.write(`${result.content}\n`);
  process.exit(0);
}

fail(`no rung could read ${url}, it needs a browser or a login`, 2);
