#!/usr/bin/env node
// lean-browser MCP server.
//
// Gives an MCP host the same ladder the skill describes, as tools it can call
// directly. This is the path for Claude Desktop and anything else that speaks
// MCP, and it runs on your machine, so the browser rungs can reach your Chrome.
//
// Every tool drives skills/lean-browser/scripts/lean-fetch.mjs rather than
// reimplementing the ladder, so the MCP path and the command line path cannot
// drift apart. The CLI is the tested thing; this file is plumbing.
//
// No dependencies. Node 20 or newer. Nothing but JSON-RPC goes to stdout.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "skills", "lean-browser", "scripts", "lean-fetch.mjs");

// Echo the client's version when it names one, since the host knows what it
// speaks better than we do.
const DEFAULT_PROTOCOL = "2025-11-25";

const TOOLS = [
  {
    name: "lean_fetch",
    description:
      "Read a web page at the lowest cost that works. Tries a cheap CLI fetcher first and falls back to a real browser only when the page needs JavaScript. Use for research, documentation, release notes, issue threads, or any page you need the content of. Prefer this over a raw HTML fetch.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to read." },
        budget: {
          type: "integer",
          description: "Render target in tokens for the cheap rungs. Default 1000. Raise it only when you must have a whole page.",
        },
        find: {
          type: "string",
          description: "Return just the places this string appears on the page, instead of the whole render.",
        },
      },
      required: ["url"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "lean_search",
    description:
      "Search the web and get back a compact numbered result list. Use when you need to find pages rather than read one. Cheaper than a built-in web search on most queries. Prefer ddg, which ranks better; bing is the fallback when DuckDuckGo challenges the request. Result links are unwrapped from the engine's redirect, so the URLs are usable as citations.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        engine: {
          type: "string",
          enum: ["ddg", "bing"],
          description: "Search engine. Default ddg. DuckDuckGo challenges automated clients more often, so bing is the fallback.",
        },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "lean_links",
    description:
      "Read a page but return the interactive element tree with link URLs, instead of the page text. Use when you need the URL behind a link, since the plain text view drops hrefs. Costs about twice lean_fetch.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to read." },
      },
      required: ["url"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "lean_check",
    description:
      "Report which tools the ladder needs are installed, and the install command for whichever is missing. Run this first if reads are failing unexpectedly.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];

// Runs the CLI and resolves with its exit code, output, and rung log.
function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: `${stderr}${err.message}` }));
    child.on("close", (code) => resolve({ code: code === null ? -1 : code, stdout, stderr }));
  });
}

// The CLI writes its rung log to stderr, and its last act on success is a
// "read via rung N" line, which is the provenance worth reporting.
function rungNote(stderr) {
  const lines = stderr
    .split("\n")
    .map((l) => l.replace(/^lean-fetch:\s*/, "").trim())
    .filter(Boolean);
  const settled = [...lines].reverse().find((l) => /^read via rung \d/.test(l));
  if (settled) return settled;
  return [...lines].reverse().find((l) => /^rung \d/.test(l)) || "";
}

async function callTool(name, args) {
  if (name === "lean_check") {
    const res = await runCli(["--check"]);
    return { text: res.stdout.trim(), isError: res.code !== 0 };
  }

  if (name === "lean_search") {
    const engine = args.engine === "bing" ? "bing" : "ddg";
    // A search page spends a lot of its budget on chrome above the results.
    // DuckDuckGo fits the script's default, so only Bing asks for more room.
    // The default itself lives in lean-fetch.mjs; do not duplicate it here.
    const cliArgs = [engine, "search", String(args.query ?? "")];
    if (engine === "bing") cliArgs.push("--budget", "1200");
    const res = await runCli(cliArgs);
    if (res.code === 0) {
      return { text: res.stdout.trim() };
    }
    return {
      text:
        `Search failed through ${engine}.\n\n` +
        (res.stderr.trim() ? `${res.stderr.trim()}\n\n` : "") +
        "If this was a bot challenge, try engine bing, or read a known result URL with lean_fetch.",
      isError: true,
    };
  }

  if (name === "lean_fetch" || name === "lean_links") {
    const url = String(args.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return { text: `lean-browser needs an absolute http or https URL. Got: ${url}`, isError: true };
    }
    const cliArgs = [url];
    if (name === "lean_links") cliArgs.push("--links");
    if (args.budget) cliArgs.push("--budget", String(args.budget));
    if (args.find) cliArgs.push("--find", String(args.find));

    const res = await runCli(cliArgs);
    if (res.code === 0) {
      const note = rungNote(res.stderr);
      const suffix = note ? `\n\n[${note}]` : "";
      return { text: `${res.stdout.trim()}${suffix}` };
    }
    if (res.code === 2) {
      return {
        text:
          `Nothing readable at ${url}.\n\n` +
          "The cheap rungs could not read it and the browser rung produced no content. " +
          "That usually means the page needs a login, or a bot challenge is blocking it. " +
          "Do not retry the same URL unchanged.",
      };
    }
    return { text: res.stderr.trim() || "lean-browser failed to run.", isError: true };
  }

  return { text: `Unknown tool: ${name}`, isError: true };
}

// ---------------------------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

// stdin can close while a tool call is still running, and a tool call here can
// take a minute when it reaches the browser rung. Exit only once nothing is in
// flight, or a client that closes its pipe early loses the answer.
const inFlight = new Set();
let stdinClosed = false;

function maybeExit() {
  if (stdinClosed && inFlight.size === 0) process.exit(0);
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    process.stderr.write("lean-browser-mcp: skipping a line that is not JSON\n");
    return;
  }

  const { id, method, params } = msg;

  // Notifications carry no id and get no reply.
  if (typeof method === "string" && method.startsWith("notifications/")) return;

  try {
    if (method === "initialize") {
      const requested = params && params.protocolVersion;
      sendResult(id, {
        protocolVersion: requested || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "lean-browser", version: "0.1.0" },
      });
      return;
    }

    if (method === "ping") {
      sendResult(id, {});
      return;
    }

    if (method === "tools/list") {
      sendResult(id, { tools: TOOLS });
      return;
    }

    if (method === "tools/call") {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const outcome = await callTool(name, args);
      sendResult(id, {
        content: [{ type: "text", text: outcome.text || "" }],
        isError: Boolean(outcome.isError),
      });
      return;
    }

    sendError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    sendError(id, -32603, `lean-browser internal error: ${err && err.message}`);
  }
}

rl.on("line", (line) => {
  const pending = handleLine(line).finally(() => {
    inFlight.delete(pending);
    maybeExit();
  });
  inFlight.add(pending);
});

rl.on("close", () => {
  stdinClosed = true;
  maybeExit();
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
