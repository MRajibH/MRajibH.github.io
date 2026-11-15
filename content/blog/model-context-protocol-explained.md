---
title: "Model Context Protocol (MCP) explained with a working server"
description: "How MCP connects AI applications to tools and data: the architecture, the messages on the wire, and a Python server you can run and test."
date: 2026-11-15
tags: [rag-and-agents]
art:
  kind: flow
  caption: "MCP is the connection between an AI application and the tools it can use."
  items: ["AI application", "MCP client", "MCP server", "Tools and data"]
art:
  kind: flow
  caption: "A host application reaches tools and data through an MCP client and server."
  items: ["Host and model", "MCP client", "MCP server", "Tools and data"]
draft: true
---

Every AI application that can call tools needs those tools written for it, and without a shared standard each assistant, editor and agent framework ends up with its own incompatible plug-in format. The Model Context Protocol (MCP) is an open standard that fixes this: you write a server once, and any MCP-capable application can use it. This guide explains how the protocol works, shows the actual messages, and builds a small Python server that you can run, test and connect to a real application.

Tool calling itself, the loop in which a model asks for a function and reads the result, is covered in [Build an AI agent with tool calling](/blog/build-ai-agent-with-tool-calling/). MCP sits one level below that: it is how the application finds out which tools exist and how it invokes them.

## The problem MCP solves

Suppose you have three AI applications and four systems you want them to reach, such as a ticket tracker, a database, a documentation folder and a monitoring API. Without a standard, that is up to twelve integrations, each written against a different plug-in interface. With a standard protocol in the middle, it is three clients and four servers, and every new server works with every existing application.

The [specification](https://modelcontextprotocol.io/specification/latest) compares this to the Language Server Protocol, which did the same thing for programming-language support in editors. MCP defines three roles:

- **Host**: the AI application the person uses, such as a desktop assistant or an editor. The host owns the language model and the conversation.
- **Client**: a connector inside the host. The host creates one client for each server it talks to.
- **Server**: a program that exposes capabilities. It knows nothing about the model or the conversation; it only answers requests.

The model never talks to a server directly. The host reads the list of tools from its clients, passes their descriptions to the model, and when the model asks for a tool, the host decides whether to allow it and sends the call through the right client.

## What a server can offer

A server exposes three kinds of thing, and the difference between them is who decides when they are used.

| Primitive | What it is | Who triggers it | Example |
| --- | --- | --- | --- |
| Tool | A function with typed arguments that does something or computes something | The model, subject to the host's approval | Search tickets, run a query |
| Resource | Read-only data identified by a URI | The application or the user, to add context | A file, a database schema |
| Prompt | A reusable message template with arguments | The user, typically from a menu or slash command | "Summarise this incident" |

Tools get most of the attention because they are what makes an agent able to act. Resources and prompts are useful when you want the person, not the model, to choose what goes into the conversation.

The protocol also defines features that flow the other way. Elicitation lets a server ask the user for a missing piece of information part-way through a request. Two older client features, sampling and roots, are marked as deprecated in the current revision, so new servers should not depend on them.

## How the protocol works

MCP messages are JSON-RPC 2.0. There are three shapes: a request has an `id` and a `method`; a response carries the same `id` with either a `result` or an `error`; a notification has a `method` and no `id`, and gets no reply.

### Stateless requests

MCP specifications are versioned by date. The current revision, `2026-07-28`, made a significant change: the protocol is now stateless. Earlier revisions opened every connection with an `initialize` handshake that agreed a version and exchanged capabilities, and a server could then remember that state for the life of the connection. The handshake has been removed. Instead, every request carries its own protocol version and client capabilities in a `_meta` object, and a server must not infer anything from previous requests on the same connection.

A tool call therefore looks like this:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "search_runbooks",
    "arguments": { "query": "disk full" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "example-host", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

And the reply:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "resultType": "complete",
    "content": [{ "type": "text", "text": "disk-full" }],
    "structuredContent": { "result": ["disk-full"] },
    "isError": false
  }
}
```

Three fields in the result are worth knowing. `content` is a list of blocks (text, images, audio, links to resources) intended for the model to read. `structuredContent` is the same result as plain JSON for programs to consume, optionally validated against an output schema the tool declares. `resultType` is `complete` for a finished result, or `input_required` when the server needs something more from the client, such as an answer from the user, before it can finish; the client then repeats the request with the extra input attached.

Statelessness means any replica of a server behind a load balancer can answer any request, and a restarted server loses nothing. If a tool needs state across calls, the server returns an explicit handle and the model passes it back as an ordinary argument.

A client that wants to know what a server supports before calling anything can send `server/discover`, which every server must implement. If a client asks for a protocol version the server does not speak, the server replies with an error listing the versions it does support, and the client retries with one of those.

### Discovering and calling tools

The core methods are few:

- `tools/list` returns each tool's `name`, `description` and `inputSchema`, a JSON Schema describing its arguments.
- `tools/call` runs one tool with arguments.
- `resources/list`, `resources/templates/list` and `resources/read` do the same for resources.
- `prompts/list` and `prompts/get` do the same for prompts.

Failures come in two forms, and the distinction matters when you write a server. A **protocol error** is a JSON-RPC `error` response: the request itself was invalid, for example an unknown tool name. A **tool execution error** is a normal result with `isError` set to `true` and a message in `content`. The second kind is shown to the model, which can read the message and try again with different arguments, so it is the right choice for anything the model could fix.

### Transports

The same messages travel over one of two standard transports.

**stdio**: the host starts the server as a child process and exchanges newline-delimited JSON over its standard input and output. This is the usual choice for a server running on the same machine as the host. The rule that catches most people out: a server must write nothing to standard output except MCP messages. Diagnostic output belongs on standard error.

**Streamable HTTP**: the server is an independent web service with a single endpoint, for example `https://example.com/mcp`. The client sends each message as an HTTP POST, and the server answers with either a JSON body or a Server-Sent Events stream scoped to that request. Requests carry an `MCP-Protocol-Version` header and headers that mirror the method and tool name, so proxies can route without parsing the body. This is the choice for a shared, remote server.

## Build a working server

The server below gives an assistant access to a folder of operational runbooks, the kind of Markdown notes a team keeps for handling incidents. It offers a tool to search them, a resource to read one, and a prompt.

It uses the official [Python SDK](https://github.com/modelcontextprotocol/python-sdk). Install it along with its command-line tool, using `uv` or `pip`:

```bash
mkdir runbook-server && cd runbook-server
python3 -m venv .venv && source .venv/bin/activate
pip install "mcp[cli]"

mkdir runbooks
printf '# Disk full\n\nCheck usage with df -h, then clear old journal files.\n' > runbooks/disk-full.md
printf '# High load\n\nFind the busiest processes with top or pidstat.\n' > runbooks/high-load.md
```

One note on versions before the code. Version 2 of the SDK renamed its high-level server class to `MCPServer`, imported from `mcp.server`. Tutorials written for version 1 import a class called `FastMCP` from `mcp.server.fastmcp`; that import path no longer exists in version 2. The decorators work the same way under both names.

```python
# server.py
import logging
from pathlib import Path
from typing import Annotated

from pydantic import Field

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

RUNBOOK_DIR = Path(__file__).parent / "runbooks"
log = logging.getLogger("runbooks")

mcp = MCPServer("Runbooks")


def _runbook_path(name: str) -> Path:
    """Map a runbook name to a file, refusing anything outside the folder."""
    if not name.replace("-", "").isalnum():
        raise ToolError("Runbook names contain only letters, digits and hyphens.")
    path = RUNBOOK_DIR / f"{name}.md"
    if not path.is_file():
        available = sorted(p.stem for p in RUNBOOK_DIR.glob("*.md"))
        raise ToolError(f"No runbook named {name!r}. Available: {available}")
    return path


@mcp.tool()
def search_runbooks(
    query: Annotated[str, Field(description="Word or phrase to look for, case-insensitive.")],
) -> list[str]:
    """Return the names of runbooks whose text contains the query."""
    needle = query.strip().lower()
    if not needle:
        raise ToolError("The query must not be empty.")
    matches = [
        path.stem
        for path in sorted(RUNBOOK_DIR.glob("*.md"))
        if needle in path.read_text(encoding="utf-8").lower()
    ]
    log.info("search %r matched %d runbooks", query, len(matches))
    return matches


@mcp.tool()
def read_runbook(
    name: Annotated[str, Field(description="Runbook name as returned by search_runbooks.")],
) -> str:
    """Return the full Markdown text of one runbook."""
    return _runbook_path(name).read_text(encoding="utf-8")


@mcp.resource("runbook://{name}", mime_type="text/markdown")
def runbook_resource(name: str) -> str:
    """A runbook, addressable by URI."""
    return _runbook_path(name).read_text(encoding="utf-8")


@mcp.prompt()
def incident_summary(service: str) -> str:
    """Draft an incident summary for a service."""
    return (
        f"Write a short incident summary for the {service} service. "
        "Search the runbooks for relevant procedures and cite the ones you used."
    )


if __name__ == "__main__":
    mcp.run()
```

What each part does, and why it is written this way:

- **`@mcp.tool()`** registers a function. The function name becomes the tool name, the docstring becomes the description, and the type hints become the input schema. The `Field(description=...)` text is added to the schema, so the model sees what each argument means. Clear descriptions are the single biggest influence on whether a model uses a tool correctly.
- **`ToolError`** produces a tool execution error: a result with the error flag set and your message in it. The model can read "No runbook named 'disk'. Available: [...]" and correct its next call. Any other exception is treated as a crash, and the SDK withholds its text from the client.
- **`_runbook_path`** is the security boundary. The model supplies `name`, so it must be treated as untrusted input. Restricting it to letters, digits and hyphens rules out values such as `../../etc/passwd`, and confining lookups to one folder limits what the server can ever reveal.
- **`@mcp.resource("runbook://{name}")`** defines a resource template. The part in braces is filled from the URI, so `runbook://disk-full` reads that file.
- **`logging`** rather than `print`. Over stdio, standard output is the protocol channel. The SDK's logging setup writes to standard error, which is safe.
- **`mcp.run()`** with no arguments serves over stdio. It sits under the `__main__` guard because the SDK's command-line tools import the file, and importing must not start the server.

## Test it and connect it

### Test in process

The SDK's `Client` can connect to a server object directly, with no subprocess or network. That makes a quick check easy:

```python
# check_server.py
import anyio

from mcp import Client
from server import mcp


async def main() -> None:
    async with Client(mcp) as client:
        listed = await client.list_tools()
        print("tools:", [tool.name for tool in listed.tools])

        found = await client.call_tool("search_runbooks", {"query": "journal"})
        print("search:", found.structured_content)

        missing = await client.call_tool("read_runbook", {"name": "nope"})
        print("is_error:", missing.is_error)
        print("message:", missing.content[0].text)


anyio.run(main)
```

Run `python check_server.py`. The search should report the `disk-full` runbook, with the list wrapped under a `result` key because the tool returns a list rather than an object. The last call should print `is_error: True` and the message listing the available runbooks, without raising an exception in the client.

### Inspect interactively

The MCP Inspector is a browser-based tool for calling a server by hand. The SDK launches it for you (it needs Node.js, since the Inspector runs through `npx`):

```bash
mcp dev server.py
```

Use it to confirm that the generated schemas and descriptions read the way you intended, since those are what a model will see.

### Connect a real host

Hosts that launch stdio servers need a command to run. Use absolute paths, because the host starts the server from its own working directory. For Claude Code:

```bash
claude mcp add runbooks -- /absolute/path/to/runbook-server/.venv/bin/python /absolute/path/to/runbook-server/server.py
```

For VS Code, create `.vscode/mcp.json` in the project:

```json
{
  "servers": {
    "runbooks": {
      "type": "stdio",
      "command": "/absolute/path/to/runbook-server/.venv/bin/python",
      "args": ["/absolute/path/to/runbook-server/server.py"]
    }
  }
}
```

Other hosts use a similar JSON entry with a command and arguments; check the host's documentation for the file location.

### Serve over HTTP

To make the server reachable by remote hosts, change the last line:

```python
mcp.run(transport="streamable-http", port=3001)
```

The SDK binds to `127.0.0.1` by default and serves at the `/mcp` path, so this example listens at `http://127.0.0.1:3001/mcp`. Leave it on the loopback address and put a reverse proxy with TLS and authentication in front before exposing it to anything else.

## Security you cannot skip

An MCP server is code that a language model can trigger, so it deserves the same suspicion as any remotely callable API, plus some that is particular to this setting.

**Treat every argument as untrusted.** The model chooses the arguments, and the model can be steered by text it has read. Validate types, ranges and formats inside each tool, as `_runbook_path` does. The specification requires servers to validate all tool inputs.

**Give the server the least access that works.** A read-only database user, a single directory, a token limited to one project. The damage a misused tool can do is bounded by what the server process is able to do.

**Treat tool output as untrusted too.** A runbook, ticket or web page returned by a tool may contain text written to manipulate the model, an attack known as indirect prompt injection. A server cannot fully prevent this, but it can avoid mixing sensitive and attacker-writable content, and hosts should require confirmation for consequential actions. [Prompt injection defence](/blog/prompt-injection-defence/) goes into the details.

**Only install servers you trust.** A server's tool descriptions are fed to the model, so a malicious server can use them to influence behaviour, and a local stdio server runs with your user's permissions. Read the source or use servers from publishers you have reason to trust. The specification also says that the behaviour hints a tool declares about itself, such as being read-only, must be treated as untrusted unless the server is.

**Protect HTTP servers properly.** The specification requires Streamable HTTP servers to validate the `Origin` header to prevent DNS rebinding attacks, in which a web page in the user's browser reaches a server on localhost. It also recommends binding local servers to the loopback address only and authenticating every connection. For remote servers MCP defines an authorisation framework based on OAuth. stdio servers should take credentials from environment variables instead; [the secrets management guide](/blog/secrets-management-guide/) covers handling them.

**Keep a person in the loop.** The specification states that there should always be a human able to deny tool invocations.

## Common mistakes

**Printing to standard output in a stdio server.** A stray `print()` corrupts the message stream, and the host reports a parse error or drops the connection. Use `logging`, or print to standard error.

**Following a version 1 tutorial with version 2 installed.** An `ImportError` for `mcp.server.fastmcp` means the example predates the rename. Import `MCPServer` from `mcp.server` instead, or check the SDK's migration guide.

**Relative paths in host configuration.** The host launches the server from its own working directory. Use absolute paths, and resolve data paths from `__file__` as the example does.

**Raising generic exceptions for expected failures.** If a lookup fails with a bare `KeyError`, the model receives a generic failure with no detail. Raise `ToolError` with a message that says what to do differently.

**Keeping state in module variables between calls.** Under the stateless revision, consecutive requests may reach different processes. Return an explicit handle and accept it as an argument.

**The server does not appear in the host.** Run the configured command in a terminal. A working stdio server starts and waits silently for input; a traceback or an immediate exit is the real error. Restart the host after changing its configuration.

## Frequently asked questions

### Is MCP the same thing as tool calling?

No. Tool calling is the exchange between an application and a language model, in which the model asks for a function to be run. MCP is the exchange between an application and the programs that provide those functions. A host uses MCP to collect tool definitions and execute calls, and uses its model provider's tool-calling API to let the model choose among them.

### Do I need MCP if I am writing my own agent?

Not for tools that live in the same codebase; plain functions are simpler. MCP earns its place when you want the same tools available in several applications, when tools are maintained by another team, or when you want to use servers other people have already written.

### Should I use stdio or Streamable HTTP?

Use stdio for a server that runs on the user's own machine and works with local files or local credentials. Use Streamable HTTP for a shared service that several users or hosts connect to, and plan for authentication from the start.

### What changed in the 2026-07-28 revision?

The connection handshake and protocol-level sessions were removed, so every request now carries its own version and capabilities and can be handled independently. Server-initiated requests were replaced by results that ask the client for more input, and sampling and roots were marked as deprecated. Current SDKs handle both the new and the older style, so a server written with a recent SDK can serve clients from either era.
