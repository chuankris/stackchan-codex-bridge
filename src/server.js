import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_CWD = resolve(process.env.CODEX_BRIDGE_DEFAULT_CWD || process.cwd());
const CODEX_BIN = process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex";
const ALLOWED_ROOTS = (process.env.CODEX_BRIDGE_ALLOWED_ROOTS || DEFAULT_CWD)
  .split(":")
  .map((item) => resolve(item))
  .filter(Boolean);

const state = {
  status: "idle",
  startedAt: null,
  completedAt: null,
  cwd: null,
  sandbox: null,
  promptPreview: null,
  threadId: null,
  turnStatus: null,
  currentItem: null,
  lastMessage: "",
  lastError: "",
  events: [],
  exitCode: null,
};

let activeProcess = null;
let stdoutBuffer = "";
let stderrBuffer = "";

function jsonContent(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function pushEvent(event) {
  state.events.push({ at: new Date().toISOString(), ...event });
  if (state.events.length > 80) {
    state.events.splice(0, state.events.length - 80);
  }
}

function publicStatus() {
  return {
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    cwd: state.cwd,
    sandbox: state.sandbox,
    promptPreview: state.promptPreview,
    threadId: state.threadId,
    turnStatus: state.turnStatus,
    currentItem: state.currentItem,
    lastMessage: state.lastMessage,
    lastError: state.lastError,
    exitCode: state.exitCode,
    events: state.events.slice(-20),
  };
}

function isInsideAllowedRoot(candidate) {
  const resolved = resolve(candidate);
  return ALLOWED_ROOTS.some((root) => {
    const rel = relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
  });
}

function resolveCwd(cwd) {
  const resolved = resolve(cwd || DEFAULT_CWD);
  if (!isInsideAllowedRoot(resolved)) {
    throw new Error(`cwd is outside allowed roots: ${resolved}`);
  }
  return resolved;
}

function codexCommand() {
  return existsSync(CODEX_BIN) ? CODEX_BIN : "codex";
}

function resetRun({ prompt, cwd, sandbox }) {
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  state.cwd = cwd;
  state.sandbox = sandbox;
  state.promptPreview = prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt;
  state.threadId = null;
  state.turnStatus = null;
  state.currentItem = null;
  state.lastMessage = "";
  state.lastError = "";
  state.events = [];
  state.exitCode = null;
  stdoutBuffer = "";
  stderrBuffer = "";
  pushEvent({ type: "bridge.started" });
}

function handleCodexEvent(event) {
  pushEvent({ type: event.type, raw: event });

  if (event.type === "thread.started") {
    state.threadId = event.thread_id;
  } else if (event.type === "turn.started") {
    state.turnStatus = "started";
  } else if (event.type === "turn.completed") {
    state.turnStatus = "completed";
    state.status = "completed";
    state.completedAt = new Date().toISOString();
  } else if (event.type === "turn.failed" || event.type === "error") {
    state.turnStatus = "failed";
    state.status = "failed";
    state.completedAt = new Date().toISOString();
    state.lastError = event.message || event.error?.message || JSON.stringify(event);
  } else if (event.type === "item.started") {
    state.currentItem = summarizeItem(event.item);
    if (event.item?.type === "command_execution") {
      state.status = "command_running";
    }
  } else if (event.type === "item.completed") {
    state.currentItem = summarizeItem(event.item);
    if (event.item?.type === "agent_message" && event.item.text) {
      state.lastMessage = event.item.text;
    }
    if (state.status === "command_running") {
      state.status = "running";
    }
  }
}

function summarizeItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    command: item.command,
    text: item.text ? String(item.text).slice(0, 300) : undefined,
  };
}

function consumeJsonLines(chunk) {
  stdoutBuffer += chunk.toString("utf8");
  let newlineIndex = stdoutBuffer.indexOf("\n");

  while (newlineIndex !== -1) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim();
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
    if (line) {
      try {
        handleCodexEvent(JSON.parse(line));
      } catch (error) {
        pushEvent({ type: "bridge.parse_error", line, error: error.message });
      }
    }
    newlineIndex = stdoutBuffer.indexOf("\n");
  }
}

function startCodexTask({ prompt, cwd, sandbox, skipGitRepoCheck }) {
  if (activeProcess) {
    throw new Error("Codex is already running. Use codex_get_status or codex_interrupt first.");
  }

  const resolvedCwd = resolveCwd(cwd);
  const selectedSandbox = sandbox || "read-only";
  resetRun({ prompt, cwd: resolvedCwd, sandbox: selectedSandbox });

  const args = ["exec", "--json", "--cd", resolvedCwd, "--sandbox", selectedSandbox];
  if (skipGitRepoCheck !== false) {
    args.push("--skip-git-repo-check");
  }
  args.push(prompt);

  activeProcess = spawn(codexCommand(), args, {
    cwd: resolvedCwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  activeProcess.stdout.on("data", consumeJsonLines);
  activeProcess.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) pushEvent({ type: "codex.stderr", text: line.trim() });
    }
  });

  activeProcess.on("error", (error) => {
    state.status = "failed";
    state.turnStatus = "failed";
    state.completedAt = new Date().toISOString();
    state.lastError = error.message;
    pushEvent({ type: "bridge.spawn_error", error: error.message });
    activeProcess = null;
  });

  activeProcess.on("close", (code) => {
    state.exitCode = code;
    if (stdoutBuffer.trim()) {
      try {
        handleCodexEvent(JSON.parse(stdoutBuffer.trim()));
      } catch {
        pushEvent({ type: "bridge.trailing_stdout", text: stdoutBuffer.trim() });
      }
    }
    if (stderrBuffer.trim()) {
      pushEvent({ type: "codex.stderr", text: stderrBuffer.trim() });
    }
    if (state.status !== "completed" && state.status !== "failed") {
      state.status = code === 0 ? "completed" : "failed";
      state.turnStatus = code === 0 ? "completed" : "failed";
      state.completedAt = new Date().toISOString();
    }
    if (code !== 0 && !state.lastError) {
      state.lastError = `codex exited with code ${code}`;
    }
    pushEvent({ type: "bridge.exited", code });
    activeProcess = null;
  });

  return publicStatus();
}

function interruptCodex() {
  if (!activeProcess) {
    return { interrupted: false, status: publicStatus() };
  }
  activeProcess.kill("SIGINT");
  pushEvent({ type: "bridge.interrupt_requested" });
  state.status = "interrupting";
  return { interrupted: true, status: publicStatus() };
}

function createMcpServer() {
  const server = new McpServer({
    name: "stackchan-codex-bridge",
    version: "0.1.0",
  });

  server.registerTool(
    "codex_start_task",
    {
      title: "Start a Codex task",
      description: "Start a Codex task on this Mac and return immediately with monitorable status.",
      inputSchema: {
        prompt: z.string().min(1).describe("The task to give to Codex."),
        cwd: z.string().optional().describe("Working directory. Must be under an allowed root."),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
        skipGitRepoCheck: z.boolean().optional(),
      },
    },
    async ({ prompt, cwd, sandbox, skipGitRepoCheck }) => {
      return jsonContent(startCodexTask({ prompt, cwd, sandbox, skipGitRepoCheck }));
    },
  );

  server.registerTool(
    "codex_get_status",
    {
      title: "Get Codex status",
      description: "Read the current Codex bridge state, including recent events and the last agent message.",
    },
    async () => jsonContent(publicStatus()),
  );

  server.registerTool(
    "codex_get_last_message",
    {
      title: "Get last Codex message",
      description: "Return the most recent final or partial Codex message captured by the bridge.",
    },
    async () => jsonContent({ lastMessage: state.lastMessage, status: publicStatus() }),
  );

  server.registerTool(
    "codex_interrupt",
    {
      title: "Interrupt Codex",
      description: "Ask the currently running Codex process to stop.",
    },
    async () => jsonContent(interruptCodex()),
  );

  return server;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

const transports = {};

async function handleMcpRequest(req, res) {
  const sessionId = req.headers["mcp-session-id"];

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport && !sessionId && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports[newSessionId] = transport;
        },
      });

      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) delete transports[closedSessionId];
      };

      const server = createMcpServer();
      await server.connect(transport);
    }

    if (!transport) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid MCP session ID provided" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, body);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: Missing or invalid MCP session ID" },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res);
    return;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
}

const httpServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, service: "stackchan-codex-bridge" });
      return;
    }

    if (url.pathname === "/status" && req.method === "GET") {
      sendJson(res, 200, publicStatus());
      return;
    }

    if (url.pathname === "/tasks" && req.method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, 202, startCodexTask(body));
      return;
    }

    if (url.pathname === "/interrupt" && req.method === "POST") {
      sendJson(res, 200, interruptCodex());
      return;
    }

    if (url.pathname === "/mcp") {
      await handleMcpRequest(req, res);
      return;
    }

    sendJson(res, 404, {
      error: "not_found",
      endpoints: ["GET /healthz", "GET /status", "POST /tasks", "POST /interrupt", "POST/GET /mcp"],
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`StackChan Codex bridge listening on http://${HOST}:${PORT}`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`Allowed roots: ${ALLOWED_ROOTS.join(", ")}`);
});
