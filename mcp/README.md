# The lean-browser MCP Server

`lean-browser.mjs` gives an MCP host the same ladder the skill describes, as
four tools it can call directly.

This is the path that matters for **Claude Desktop**, and it is worth explaining
why. A skill uploaded to Claude Desktop runs in Anthropic's code execution
container, not on your machine, so the browser rungs have no Chrome to drive.
This server runs on your machine, so the whole ladder works.

It also means one implementation. Every tool here drives
`skills/lean-browser/scripts/lean-fetch.mjs`, which is the tested code path, so
the MCP route and the command line cannot drift apart.

## The Tools

| Tool | What it does |
| --- | --- |
| `lean_fetch` | Read a page. Runs the ladder, escalating to a browser only if the page needs one |
| `lean_search` | Search the web, returning a compact numbered result list with usable URLs |
| `lean_links` | Read a page and return the element tree with link URLs, for when you need the URL behind a link |
| `lean_check` | Report which tools the ladder needs are installed |

All four are read-only and marked as such, so a host that shows approval prompts
can tell they do not change anything.

## Requirements

Node 20 or newer, plus whichever rungs you want available:

```bash
npm install -g @only-cli/oc                              # rungs 1 and 2
npm install -g agent-browser && agent-browser install     # rungs 3 and 4
```

No install, no problem: the server calls `oc` through a pinned `npx`, so the
cheap rungs work without a global install.

## Register It

### Claude Desktop

Add the server to `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lean-browser": {
      "command": "node",
      "args": ["/absolute/path/to/lean-browser/mcp/lean-browser.mjs"]
    }
  }
}
```

Restart Claude Desktop afterwards. If your build offers a settings page for
adding local MCP servers, that works too, and it will write the same entry for
you. Use an absolute path: the app does not start in your repo, so a relative
path will not resolve.

### Claude Code

```bash
claude mcp add lean-browser -- node /absolute/path/to/lean-browser/mcp/lean-browser.mjs
```

### Zed

Add it under `context_servers` in your settings file (`zed: open settings
file`), or use **Settings > AI > MCP Servers > Add Server > Add Local Server**:

```json
{
  "context_servers": {
    "lean-browser": {
      "command": "node",
      "args": ["/absolute/path/to/lean-browser/mcp/lean-browser.mjs"],
      "env": {}
    }
  }
}
```

The indicator dot next to the server name turns green when it is running.

### Any Other MCP Host

It speaks JSON-RPC over stdio and has no dependencies, so any host that can
launch a command can launch it:

```
node /absolute/path/to/lean-browser/mcp/lean-browser.mjs
```

## Trying It Without A Host

You can drive the server by hand, which is also how it is tested:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lean_fetch","arguments":{"url":"https://example.com"}}}' \
  | node mcp/lean-browser.mjs
```

## Notes

- Only JSON-RPC goes to stdout. Diagnostics go to stderr, so a host reading the
  stream never sees anything it cannot parse.
- The server waits for an in-flight tool call before exiting when stdin closes.
  A browser rung can take a minute, and a host that closes its pipe early should
  still get its answer.
- Tool results end with a line naming the rung that produced them, so you can
  see whether a page cost 40 tokens or a browser launch.
- The search tools unwrap the engine's redirect wrapper from each result URL, so
  what you get back is a citation rather than a tracking link.
