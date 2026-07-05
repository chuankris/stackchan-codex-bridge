# Alibaba Cloud Deployment

Target server:

- Public IP: `39.105.184.139`
- SSH user: `root`
- SSH port: `22`
- Deployment path: `/opt/stackchan-codex-bridge`

Do not commit the server password or Xiaozhi endpoint token.

## Current State

As of 2026-07-05:

- `stackchan-cloud-news.service` is installed, enabled, and active.
- `stackchan-xiaozhi-client.service` is installed, enabled, and active.
- `stackchan-xiaozhi-watchdog.timer` is installed, enabled, and active.
- Tencent Cloud's `stackchan-xiaozhi-client.service` is stopped so that the Alibaba Cloud instance is the only active Xiaozhi MCP endpoint client.
- The cloud news MCP endpoint is local to the server: `http://127.0.0.1:8788/mcp`.
- The Xiaozhi Web UI uses port `10099`.
- The active MCP tools are:
  - `news_daily_briefing`
  - `news_list_sources`
  - `stock_quote`
  - `stock_daily_briefing`

## Deployment Notes

Alibaba Cloud could connect to the Xiaozhi endpoint and Nasdaq stock quote API successfully.

GitHub access from the server was unreliable. The server also had an old git rewrite rule:

```text
url.https://github.com.cnpmjs.org/.insteadof https://github.com/
```

The deployment used a local `git archive` tarball copied over SSH instead of cloning directly from GitHub.

Node.js v24 was already installed by nvm, but `@discordjs/opus` failed to install on Node 24. Node.js v22 was installed with the Node mirror:

```bash
source /root/.nvm/nvm.sh
export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
nvm install 22
nvm use 22
```

Dependencies were installed with script hooks disabled to avoid building unused native voice dependencies:

```bash
npm ci --ignore-scripts --registry=https://registry.npmmirror.com
```

The Python example MCP compile check is skipped on this server because the system Python is 3.6 and cannot parse `from __future__ import annotations`. The active Node services do not depend on the Python example.

## Health Checks

```bash
systemctl is-active stackchan-cloud-news stackchan-xiaozhi-client stackchan-xiaozhi-watchdog.timer
curl -s http://127.0.0.1:8788/healthz
curl -s 'http://127.0.0.1:8788/stock?symbol=AAPL'
XIAOZHI_CONFIG_DIR=/opt/stackchan-codex-bridge \
  /root/.nvm/versions/node/v22.23.1/bin/node \
  /opt/stackchan-codex-bridge/node_modules/xiaozhi-client/dist/cli/index.js mcp list --tools
```

## Switch Back To Tencent Cloud

If needed, stop Alibaba Cloud's Xiaozhi client:

```bash
systemctl disable --now stackchan-xiaozhi-client
```

Then start Tencent Cloud's Xiaozhi client:

```bash
sudo systemctl enable --now stackchan-xiaozhi-client
```
