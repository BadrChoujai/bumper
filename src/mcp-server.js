#!/usr/bin/env node
// Exposes Bumper's check as an MCP tool, for agents that don't have a native
// blocking hook (or prefer calling a tool explicitly). Native hooks (see
// src/hook-scripts/) are the primary integration — this is the fallback path.
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const DAEMON_URL = process.env.BUMPER_URL || "http://localhost:4790";

const server = new McpServer({ name: "bumper", version: "0.1.0" });

server.registerTool(
  "check_before_acting",
  {
    title: "Check with Bumper before doing something risky",
    description:
      "Call this before running a shell command or writing a file that might be destructive, " +
      "publish something publicly, or touch secrets/credentials. Bumper will allow it, deny it, " +
      "or pause and ask the human — wait for the response before proceeding.",
    inputSchema: {
      tool: z.string().describe("name of the tool/action you're about to run, e.g. Bash"),
      command: z.string().optional().describe("the shell command, if any"),
      file: z.string().optional().describe("the file path being written/edited, if any"),
      content: z.string().optional().describe("the code/content being written, if relevant"),
    },
  },
  async ({ tool, command, file, content }) => {
    try {
      const res = await fetch(`${DAEMON_URL}/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "mcp", tool, command, file, content, cwd: process.cwd() }),
      });
      const result = await res.json();
      return {
        content: [
          { type: "text", text: `${result.decision.toUpperCase()}: ${result.reason}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `ALLOW: Bumper isn't running, so this went through unchecked (${err.message}).`,
          },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
