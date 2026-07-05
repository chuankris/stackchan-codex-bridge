import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "0.0.0.0";
const DEFAULT_TIMEOUT_MS = Number(process.env.NEWS_FETCH_TIMEOUT_MS || 8000);
const DEFAULT_MAX_ITEMS = Number(process.env.NEWS_MAX_ITEMS || 6);
const CACHE_TTL_MS = Number(process.env.NEWS_CACHE_TTL_MS || 10 * 60 * 1000);

const NEWS_SOURCES = [
  {
    key: "google-business",
    name: "Google News Business",
    url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
    region: "global",
  },
  {
    key: "google-technology",
    name: "Google News Technology",
    url: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=zh-CN&gl=CN&ceid=CN:zh-Hans",
    region: "global",
  },
  {
    key: "federal-reserve",
    name: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    region: "us",
  },
  {
    key: "us-treasury",
    name: "U.S. Treasury",
    url: "https://home.treasury.gov/news/press-releases/rss.xml",
    region: "us",
  },
  {
    key: "sec-press",
    name: "SEC Press Releases",
    url: "https://www.sec.gov/news/pressreleases.rss",
    region: "us",
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

const cache = new Map();
const transports = {};

function jsonContent(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNewsText(value) {
  return stripHtml(value)
    .replace(/\s*在Google 新闻上查看更多头条新闻和观点\s*/g, "")
    .replace(/\s*View Full Coverage on Google News\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, maxLength) {
  const text = cleanNewsText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function resolveLink(item) {
  if (typeof item.link === "string") return item.link;
  if (item.link?.href) return item.link.href;
  if (Array.isArray(item.link)) {
    const link = item.link.find((entry) => entry?.href || typeof entry === "string");
    return typeof link === "string" ? link : link?.href;
  }
  return "";
}

function extractItems(source, xml) {
  const data = parser.parse(xml);
  const channelItems = asArray(data?.rss?.channel?.item);
  const atomEntries = asArray(data?.feed?.entry);
  const items = channelItems.length ? channelItems : atomEntries;

  return items.map((item) => ({
    title: truncate(item.title, 120),
    summary: truncate(item.description || item.summary || item.content, 220),
    source: source.name,
    sourceKey: source.key,
    url: resolveLink(item),
    publishedAt: item.pubDate || item.published || item.updated || null,
    region: source.region,
  }));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "stackchan-cloud-news-mcp/0.1 (+https://github.com/chuankris/stackchan-codex-bridge)",
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source) {
  const now = Date.now();
  const cached = cache.get(source.key);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const xml = await fetchWithTimeout(source.url, DEFAULT_TIMEOUT_MS);
    const items = extractItems(source, xml);
    const result = {
      ok: true,
      source,
      fetchedAt: now,
      items,
      error: null,
    };
    cache.set(source.key, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      source,
      fetchedAt: now,
      items: [],
      error: error.message,
    };
    if (!cached) cache.set(source.key, result);
    return cached || result;
  }
}

function sortByPublishedAt(items) {
  return [...items].sort((a, b) => {
    const timeA = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const timeB = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return timeB - timeA;
  });
}

function selectSources({ market, sourceKeys }) {
  if (sourceKeys?.length) {
    const selected = NEWS_SOURCES.filter((source) => sourceKeys.includes(source.key));
    if (!selected.length) throw new Error(`unknown sourceKeys: ${sourceKeys.join(", ")}`);
    return selected;
  }
  if (market === "us") return NEWS_SOURCES.filter((source) => source.region === "us");
  return NEWS_SOURCES;
}

function buildSpokenBriefing({ market, items, failedSources, maxItems }) {
  if (!items.length) {
    return "现在没有成功获取到财经新闻源，请稍后再试。";
  }

  const marketLabel = market === "us" ? "美股和美国宏观" : "全球财经";
  const lines = [`今天的${marketLabel}资讯先看这几条。`];

  for (const [index, item] of items.slice(0, maxItems).entries()) {
    const summary = item.summary && item.summary !== item.title ? item.summary : `来源是${item.source}。`;
    lines.push(`第${index + 1}条，${item.title}。${summary}`);
  }

  if (failedSources.length) {
    lines.push(`另外有${failedSources.length}个新闻源暂时没有连上，后面可以再刷新一次。`);
  }
  lines.push("以上是公开新闻整理，不构成投资建议。");
  return lines.join("");
}

async function getDailyBriefing({ market = "global", maxItems = DEFAULT_MAX_ITEMS, sourceKeys } = {}) {
  const safeMaxItems = Math.max(1, Math.min(Number(maxItems) || DEFAULT_MAX_ITEMS, 12));
  const sources = selectSources({ market, sourceKeys });
  const results = await Promise.all(sources.map(fetchSource));
  const failedSources = results
    .filter((result) => !result.ok)
    .map((result) => ({ key: result.source.key, name: result.source.name, error: result.error }));
  const items = sortByPublishedAt(results.flatMap((result) => result.items)).slice(0, safeMaxItems);

  return {
    asOf: new Date().toISOString(),
    market,
    maxItems: safeMaxItems,
    sources: sources.map((source) => ({ key: source.key, name: source.name, region: source.region })),
    failedSources,
    headline: items[0]?.title || "暂无可用财经新闻",
    items,
    spokenBriefing: buildSpokenBriefing({ market, items, failedSources, maxItems: safeMaxItems }),
    disclaimer: "Public news summary only. Not investment advice.",
  };
}

function createMcpServer() {
  const server = new McpServer({
    name: "stackchan-cloud-news",
    version: "0.1.0",
  });

  server.registerTool(
    "news_daily_briefing",
    {
      title: "Daily finance news briefing",
      description: "Fetch public RSS news and return a short Chinese spoken briefing for StackChan.",
      inputSchema: {
        market: z.enum(["global", "us"]).optional().describe("News scope. Use global by default."),
        maxItems: z.number().int().min(1).max(12).optional().describe("Maximum number of news items."),
        sourceKeys: z.array(z.string()).optional().describe("Optional source keys from news_list_sources."),
      },
    },
    async ({ market, maxItems, sourceKeys }) => jsonContent(await getDailyBriefing({ market, maxItems, sourceKeys })),
  );

  server.registerTool(
    "news_list_sources",
    {
      title: "List news sources",
      description: "List public RSS sources used by the cloud news MCP service.",
    },
    async () => jsonContent({ sources: NEWS_SOURCES }),
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
      sendJson(res, 200, { ok: true, service: "stackchan-cloud-news" });
      return;
    }

    if (url.pathname === "/sources" && req.method === "GET") {
      sendJson(res, 200, { sources: NEWS_SOURCES });
      return;
    }

    if (url.pathname === "/briefing" && req.method === "GET") {
      sendJson(res, 200, await getDailyBriefing({
        market: url.searchParams.get("market") || "global",
        maxItems: url.searchParams.get("maxItems") || DEFAULT_MAX_ITEMS,
      }));
      return;
    }

    if (url.pathname === "/mcp") {
      await handleMcpRequest(req, res);
      return;
    }

    sendJson(res, 404, {
      error: "not_found",
      endpoints: ["GET /healthz", "GET /sources", "GET /briefing", "POST/GET /mcp"],
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`StackChan cloud news MCP listening on http://${HOST}:${PORT}`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
});
