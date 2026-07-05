# StackChan Codex Bridge

Local MCP bridge for letting StackChan / Xiaozhi start and monitor Codex tasks on a Mac.

## What It Exposes

- `codex_start_task`: start a Codex task and return immediately.
- `codex_list_projects`: list the project allowlist that the robot can use.
- `codex_get_status`: read current status and recent events.
- `codex_get_last_message`: read the latest captured Codex message.
- `codex_interrupt`: stop the active Codex process.

The bridge also exposes HTTP endpoints for debugging:

- `GET /healthz`
- `GET /projects`
- `GET /status`
- `POST /tasks`
- `POST /interrupt`
- `POST/GET/DELETE /mcp`

## Quick Start

```bash
npm install
npm start
```

Default MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

Direct health check:

```bash
curl -s http://127.0.0.1:8787/healthz
```

Start a read-only Codex task:

```bash
curl -s http://127.0.0.1:8787/tasks \
  -H 'content-type: application/json' \
  -d '{"projectKey":"stackchan-bridge","prompt":"Say hello in one sentence. Do not edit files.","sandbox":"read-only"}'
```

Check progress:

```bash
curl -s http://127.0.0.1:8787/status
```

List allowed projects:

```bash
curl -s http://127.0.0.1:8787/projects
```

## Connect To Xiaozhi

The Xiaozhi access point is a reverse WebSocket connection. Xiaozhi cloud does not connect directly to your Mac; a local `xiaozhi-client` process connects out to the `wss://api.xiaozhi.me/mcp/?token=...` endpoint, then forwards tool calls to this local MCP bridge.

Copy the example config and replace the token:

```bash
cp xiaozhi.config.example.json xiaozhi.config.json
```

`xiaozhi.config.json` is ignored by git because it contains your private endpoint token.

Start the Xiaozhi client:

```bash
node node_modules/xiaozhi-client/dist/cli/index.js start --debug
```

Check tools:

```bash
node node_modules/xiaozhi-client/dist/cli/index.js mcp list --tools
```

When a Docker container needs to call the Mac host, use this URL for the local Codex bridge:

```text
http://host.docker.internal:8787/mcp
```

## Optional Docker Bridge

If you use a Xiaozhi Docker bridge, copy `docker-compose.xiaozhi.example.yml` and replace `REPLACE_WITH_NEW_TOKEN` with a fresh Xiaozhi MCP endpoint token:

```bash
docker compose -f docker-compose.xiaozhi.example.yml up -d
```

The Docker bridge reads `config/xiaozhi-bridge.example.json` and forwards tool calls to this local service.

## Cloud News MCP

For always-online robot features, run a separate cloud-safe MCP service that does not touch Codex or local project files.

Tools:

- `news_daily_briefing`: fetch public RSS sources and return a short Chinese spoken finance/news briefing.
- `news_list_sources`: list configured public RSS sources.
- `stock_quote`: fetch a read-only public quote summary for one stock.
- `stock_daily_briefing`: fetch public quotes and related news for a short Chinese spoken stock briefing.
- `web_search`: search the web through Tavily when `TAVILY_API_KEY` is configured.
- `stock_symbol_search`: resolve company names to likely stock symbols using local aliases plus Tavily search.

Start it locally:

```bash
npm run start:cloud-news
```

Default endpoints:

```text
http://0.0.0.0:8788/mcp
http://0.0.0.0:8788/healthz
http://0.0.0.0:8788/briefing
http://0.0.0.0:8788/stock?symbol=AAPL
http://0.0.0.0:8788/stock-briefing?symbols=AAPL,NVDA,0700.HK,600519.SS
http://0.0.0.0:8788/web-search?query=中国宏桥股票代码
http://0.0.0.0:8788/stock-symbol-search?query=中国宏桥
```

For Tencent Cloud, bind it to a stable port and place Nginx or a cloud load balancer with HTTPS in front:

```bash
HOST=0.0.0.0 PORT=8788 npm run start:cloud-news
```

Useful environment variables:

```text
PORT=8788
HOST=0.0.0.0
NEWS_FETCH_TIMEOUT_MS=8000
NEWS_CACHE_TTL_MS=600000
NEWS_MAX_ITEMS=6
STOCK_CACHE_TTL_MS=60000
STOCK_DEFAULT_SYMBOLS=AAPL,MSFT,NVDA,TSLA
TAVILY_API_KEY=tvly-...
TAVILY_MAX_RESULTS=5
```

Add the public HTTPS MCP URL to the Xiaozhi MCP config, for example:

```json
{
  "mcpServers": {
    "cloud-news": {
      "type": "http",
      "url": "https://your-domain.example.com/mcp"
    }
  }
}
```

This cloud service is intended for stable read-only abilities such as news, market data, weather, calendars, and reminders. Keep Mac-only abilities such as Codex control on the local bridge.

Stock tools are read-only. They do not trade, do not manage portfolios, and should not be treated as investment advice.

Tavily search is optional. If `TAVILY_API_KEY` is missing, search tools return a clear configuration error while local stock aliases continue to work.

## Run As Mac LaunchAgents

For a long-running Mac setup, install user LaunchAgents that run:

- `node src/server.js`
- `node node_modules/xiaozhi-client/dist/cli/index.js start --debug`

Suggested log directory:

```text
~/Library/Logs/StackChanCodex/
```

After installing LaunchAgent plist files, reload them with:

```bash
uid="$(id -u)"
launchctl bootstrap "gui/$uid" ~/Library/LaunchAgents/com.stackchan.codex-bridge.plist
launchctl bootstrap "gui/$uid" ~/Library/LaunchAgents/com.stackchan.xiaozhi-bridge.plist
```

Check them:

```bash
launchctl print "gui/$(id -u)/com.stackchan.codex-bridge"
launchctl print "gui/$(id -u)/com.stackchan.xiaozhi-bridge"
```

Stop them:

```bash
uid="$(id -u)"
launchctl bootout "gui/$uid" ~/Library/LaunchAgents/com.stackchan.xiaozhi-bridge.plist
launchctl bootout "gui/$uid" ~/Library/LaunchAgents/com.stackchan.codex-bridge.plist
```

## Safety Defaults

- Default sandbox is `read-only`.
- Default project allowlist comes from `codex-projects.example.json`.
- Real project allowlists should live in `codex-projects.json`, which is ignored by git.
- `codex_start_task` should use `projectKey` from `codex_list_projects`.
- Direct `cwd` is still accepted as a compatibility fallback, but it must resolve inside the project allowlist.

Create your local allowlist:

```bash
cp codex-projects.example.json codex-projects.json
```

Example allowlist:

```json
{
  "projects": [
    {
      "key": "stackchan-bridge",
      "name": "StackChan Codex Bridge",
      "path": ".",
      "description": "This MCP bridge project.",
      "defaultSandbox": "read-only"
    },
    {
      "key": "my-app",
      "name": "My App",
      "path": "/path/to/my-app",
      "description": "Application repo that StackChan may ask Codex to inspect.",
      "defaultSandbox": "read-only"
    }
  ]
}
```

You can override the allowlist path:

```bash
CODEX_BRIDGE_PROJECTS_FILE=/path/to/codex-projects.json npm start
```

Use `workspace-write` only when you want Codex to edit files. Avoid `danger-full-access` unless the Mac is otherwise isolated.

## M5t Project History MCP Tool

This repo also contains a small Python MCP server for querying M5t robot project history.

- File: `m5t_project_mcp.py`
- Tool: `m5t_list_history_projects`
- Default data source: `data/m5t_projects.example.json`
- Filters: `keyword`, `status`, `limit`

Start it:

```bash
python3 m5t_project_mcp.py
```

Default MCP endpoint:

```text
http://127.0.0.1:8791/mcp
```

To use real project data, point `M5T_PROJECTS_FILE` at a JSON file:

```bash
M5T_PROJECTS_FILE=/path/to/m5t-projects.json python3 m5t_project_mcp.py
```

JSON can be an array or an object with a `projects` array:

```json
{
  "projects": [
    {
      "project_id": "M5T-2026-0704-003",
      "name": "仓储巡检路径验证",
      "status": "completed",
      "customer": "演示客户 A",
      "started_at": "2026-07-04T09:00:00+08:00",
      "updated_at": "2026-07-04T10:35:00+08:00",
      "finished_at": "2026-07-04T10:35:00+08:00",
      "summary": "完成 3 条货架通道巡检，生成路径覆盖率和异常点记录。",
      "tags": ["巡检", "仓储", "路径"]
    }
  ]
}
```

Add it to `xiaozhi.config.json`:

```json
{
  "mcpServers": {
    "m5t-project-history": {
      "type": "http",
      "url": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

Test the tool:

```bash
curl -s http://127.0.0.1:8791/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"m5t_list_history_projects","arguments":{"keyword":"巡检","status":"completed","limit":5}}}'
```
