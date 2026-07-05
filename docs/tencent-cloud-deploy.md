# Tencent Cloud Deployment

Target server:

- Public IP: `43.163.92.205`
- SSH user: `ubuntu`
- SSH port: `22`

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
    "port": 9999
  }
}
```

Install systemd services:

```bash
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-cloud-news.service /etc/systemd/system/
sudo cp /opt/stackchan-codex-bridge/ops/systemd/stackchan-xiaozhi-client.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now stackchan-cloud-news
sudo systemctl enable --now stackchan-xiaozhi-client
```

Check status:

```bash
curl -s http://127.0.0.1:8788/healthz
curl -s 'http://127.0.0.1:8788/briefing?market=global&maxItems=2'
systemctl status stackchan-cloud-news --no-pager
systemctl status stackchan-xiaozhi-client --no-pager
journalctl -u stackchan-cloud-news -n 80 --no-pager
journalctl -u stackchan-xiaozhi-client -n 80 --no-pager
```

## Current SSH Issue

On 2026-07-05, local checks from the Mac showed:

```text
nc -vz -w 10 43.163.92.205 22
Connection to 43.163.92.205 port 22 [tcp/ssh] succeeded!

ssh -o BatchMode=yes -o ConnectTimeout=60 ubuntu@43.163.92.205 'echo ok'
Connection timed out during banner exchange
```

This means TCP port 22 is reachable, but the SSH daemon did not return the SSH protocol banner before timeout. This happens before username/password authentication.

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
