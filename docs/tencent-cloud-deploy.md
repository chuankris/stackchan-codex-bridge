# Tencent Cloud Deployment

Target server:

- Public IP: `43.163.92.205`
- SSH user: `ubuntu`
- SSH port: `22`
- Deployment path: `/opt/stackchan-codex-bridge`

Do not commit the server password or Xiaozhi endpoint token.

## Intended Runtime

Run two services on Tencent Cloud:

- `stackchan-cloud-news`: local HTTP MCP server on `127.0.0.1:8788`.
- `stackchan-xiaozhi-client`: outbound WebSocket client that connects to Xiaozhi and exposes the cloud news MCP tools.

This gives StackChan an always-online cloud tool path without requiring the Mac to stay awake.

## Install Commands

Run on the Tencent Cloud server:

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p /opt/stackchan-codex-bridge
sudo chown ubuntu:ubuntu /opt/stackchan-codex-bridge
git clone https://github.com/chuankris/stackchan-codex-bridge.git /opt/stackchan-codex-bridge
cd /opt/stackchan-codex-bridge
npm ci
```

Create `/opt/stackchan-codex-bridge/xiaozhi.config.json` on the server. It should use the real `mcpEndpoint` token and point only to the cloud news MCP:

```json
{
  "mcpEndpoint": "wss://api.xiaozhi.me/mcp/?token=REPLACE_WITH_REAL_TOKEN",
  "mcpServers": {
    "cloud-news": {
      "type": "http",
      "url": "http://127.0.0.1:8788/mcp"
    }
  },
  "connection": {
    "heartbeatInterval": 30000,
    "heartbeatTimeout": 10000,
    "reconnectInterval": 5000
  },
  "webUI": {
    "port": 10099
  }
}
```

Install systemd services:

```bash
chmod +x /opt/stackchan-codex-bridge/ops/scripts/xiaozhi-watchdog.sh
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-cloud-news.service /etc/systemd/system/
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-xiaozhi-client.service /etc/systemd/system/
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-xiaozhi-watchdog.service /etc/systemd/system/
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-xiaozhi-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stackchan-cloud-news
sudo systemctl enable --now stackchan-xiaozhi-client
sudo systemctl enable --now stackchan-xiaozhi-watchdog.timer
```

Check status:

```bash
curl -s http://127.0.0.1:8788/healthz
curl -s 'http://127.0.0.1:8788/briefing?market=global&maxItems=2'
systemctl status stackchan-cloud-news --no-pager
systemctl status stackchan-xiaozhi-client --no-pager
systemctl status stackchan-xiaozhi-watchdog.timer --no-pager
journalctl -u stackchan-cloud-news -n 80 --no-pager
journalctl -u stackchan-xiaozhi-client -n 80 --no-pager
journalctl -u stackchan-xiaozhi-watchdog -n 80 --no-pager
```

## Current SSH Issue

On 2026-07-05, local checks from the Mac initially showed:

```text
nc -vz -w 10 43.163.92.205 22
Connection to 43.163.92.205 port 22 [tcp/ssh] succeeded!

ssh -o BatchMode=yes -o ConnectTimeout=60 ubuntu@43.163.92.205 'echo ok'
Connection timed out during banner exchange
```

This means TCP port 22 is reachable, but the SSH daemon did not return the SSH protocol banner before timeout. This happens before username/password authentication.

Root cause in this environment: Clash Verge TUN/proxy was sending `43.163.92.205` through a proxy node. Adding a direct rule fixed SSH:

```yaml
prepend-rules:
  - IP-CIDR,43.163.92.205/32,DIRECT,no-resolve
```

After reloading Clash/Mihomo, `ssh ubuntu@43.163.92.205 'echo ok'` succeeded.

Check from Tencent Cloud console:

```bash
sudo systemctl status ssh --no-pager
sudo journalctl -u ssh -n 100 --no-pager
sudo ss -ltnp | grep ':22'
sudo ufw status verbose || true
```

If needed:

```bash
sudo systemctl restart ssh
```

## Current Deployment State

As of 2026-07-05:

- `stackchan-cloud-news.service` is installed, enabled, and active.
- `stackchan-xiaozhi-client.service` is installed, enabled, and active.
- `stackchan-xiaozhi-watchdog.timer` checks the Xiaozhi client once per minute and restarts it when the WebSocket closes with code `1006`.
- The cloud news MCP endpoint is local to the server: `http://127.0.0.1:8788/mcp`.
- The Xiaozhi Web UI uses port `10099` because port `9999` is already used by the piAgent service on the same server.
- The cloud Xiaozhi client exposes only:
  - `news_daily_briefing`
  - `news_list_sources`
  - `stock_quote`
  - `stock_daily_briefing`

The Mac-side Xiaozhi LaunchAgent can be stopped while this cloud service is responsible for the robot's always-online news tools.
