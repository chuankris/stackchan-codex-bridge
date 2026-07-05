# StackChan / Xiaozhi MCP Research Notes

本文记录 StackChan / Xiaozhi / MCP 相关项目调研，以及本项目后续规划取舍。

## 我们要做什么

目标不是单纯做一个 MCP demo，而是把 StackChan 变成一个可扩展的桌面机器人入口：

- 机器人负责语音、表情和轻量交互。
- Xiaozhi endpoint 负责外网接入和设备在线。
- 本机或云端 bridge 负责工具编排。
- MCP tools 负责具体能力，例如财经播报、项目查询、Codex 控制、家庭自动化。
- 模型层负责理解意图、选择工具、把结构化结果讲成自然语言。

当前本项目已经实现：

- StackChan / Xiaozhi 通过本机 `xiaozhi-client` 连接到 Mac。
- Mac 上的 `stackchan-codex-bridge` 暴露 Codex 控制 MCP 工具。
- 支持项目白名单，机器人只能选择允许的项目。
- 已预留 M5t 历史项目查询 MCP 示例。

## 相关项目

### M5Stack StackChan

Repository: https://github.com/m5stack/StackChan

官方 StackChan 项目，包含设备基础能力、App 配置、AI Agent 和硬件扩展方向。

可借鉴：

- 官方设备能力边界。
- StackChan World / AI Agent 配置方式。
- 后续表情、动作、硬件单元扩展。

不直接照搬：

- 官方项目更偏设备与固件，本项目重点是 MCP 工具平台和业务能力层。

### xiaozhi-esp32

Repository: https://github.com/78/xiaozhi-esp32

小智 ESP32 开源项目，定位是低成本 AI 聊天机器人，支持语音交互、IoT 控制和多模型接入。

可借鉴：

- 小智生态中“设备入口 + 模型 + 工具”的总体形态。
- 接入 Qwen、DeepSeek 等不同模型的思路。
- 设备侧能力和云端对话能力的分工。

不直接照搬：

- 我们当前买的是 M5Stack StackChan 成品和 StackChan World / Xiaozhi endpoint 链路，不需要先改固件。

### xiaozhi-client

Repository: https://github.com/shenjingnan/xiaozhi-client

当前项目实际采用的关键组件。它在本机连接 Xiaozhi MCP endpoint，并把本地 MCP 服务暴露给机器人。

可借鉴/继续使用：

- 本机主动连接 `wss://api.xiaozhi.me/mcp/?token=...` 的反向长连接模式。
- 本地 MCP server 聚合。
- Web UI、状态页、工具扫描能力。

注意事项：

- 本机 daemon 包装在当前环境里不如 macOS LaunchAgent 稳定。
- endpoint token 是高敏感信息，必须只放在本地忽略文件。
- 本地 MCP 工具被机器人调用时，应加项目白名单和权限分层。

### py-xiaozhi

Repository: https://github.com/huangjunsen0406/py-xiaozhi

Python 版小智生态，关键词覆盖 MCP、IoT、多模态、语音助手、边缘计算。

可借鉴：

- Python 侧模型和工具编排。
- 更轻量的自定义服务实现方式。
- 以后如果要做自己的模型代理层，Python 生态可能更适合快速实验。

不直接照搬：

- 当前 bridge 已用 Node.js MCP SDK 跑通，短期不需要整体迁移到 Python。

### stackchan-mcp

Repository: https://github.com/kisaragi-mochi/stackchan-mcp

方向和本项目相反：它让 MCP client 控制 StackChan 的身体能力，例如动作、表情、拍照或传感器。

可借鉴：

- 后续把 StackChan 的身体控制也纳入 MCP。
- 将“说话”和“动作/表情”分成不同工具。
- 让模型根据播报内容触发表情和动作。

与本项目关系：

- 本项目当前是“机器人调用外部工具”。
- `stackchan-mcp` 更像“外部工具控制机器人”。
- 未来两者可以合流：机器人既能调用工具，也能被工具驱动表现。

### xiaozhi-mcp-ha

Repository: https://github.com/mac8005/xiaozhi-mcp-ha

小智 + Home Assistant 集成项目。

可借鉴：

- 用 Xiaozhi 语音入口控制外部系统的模式。
- 家庭自动化类工具的命名、权限和反馈方式。

对我们的启发：

- 机器人可以不只服务开发场景，也可以成为家庭入口。
- 财经播报、天气、日程、提醒、家庭设备控制都适合 MCP 化。

### mcp-use voice assistant

Repository: https://github.com/mcp-use/mcp-use-voice-assistant

语音助手通过 MCP 调用工具的参考实现。

可借鉴：

- 语音入口如何组织 MCP 工具。
- 工具结果如何转成适合朗读的回复。
- 多工具场景下的路由和上下文管理。

### voice-mcp-agent

Repository: https://github.com/den-vasyliev/voice-mcp-agent

LiveKit Agents + MCP 的语音助理。

可借鉴：

- 实时语音架构。
- 语音会话和 MCP 工具调用的组合。

不直接照搬：

- 我们已有 StackChan / Xiaozhi 语音入口，不需要先引入 LiveKit。

### mcp-agent

Repository: https://github.com/lastmile-ai/mcp-agent

通用 MCP Agent 框架。

可借鉴：

- 多 MCP server 的工具编排。
- Agent workflow 结构。
- 后续如果工具越来越多，可以参考它的 orchestration 思路。

不直接照搬：

- 当前需求更小，直接在 bridge 里做工具和权限层更清楚。

### FinRobot

Repository: https://github.com/ai4finance-foundation/finrobot

金融分析 Agent 项目，偏研究报告、金融数据、多 agent 分析。

可借鉴：

- 财经分析结构。
- 数据源组织。
- “新闻 + 市场数据 + 风险提示”的输出格式。

不直接照搬：

- 对家庭机器人财经播报来说太重。
- 第一版财经播报应该轻量，目标是“每天 60 秒听懂重点”，不是生成投研报告。

## 财经播报功能建议

建议做成 MCP 工具，而不是让模型直接凭记忆回答“今天财经新闻”。

工具名建议：

```text
finance_daily_briefing
```

输入建议：

```json
{
  "market": "global",
  "locale": "zh-CN",
  "maxItems": 5
}
```

输出建议：

```json
{
  "asOf": "2026-07-05T08:00:00+08:00",
  "headline": "今日市场一句话总结",
  "items": [
    {
      "title": "新闻标题",
      "summary": "一句话摘要",
      "source": "来源名称",
      "url": "https://..."
    }
  ],
  "risks": ["风险提示"],
  "spokenBriefing": "适合机器人朗读的 60 秒中文稿"
}
```

第一版数据源可以从公开 RSS / 新闻源开始：

- Federal Reserve RSS: https://www.federalreserve.gov/feeds/feeds.htm
- SEC Press Releases: https://www.sec.gov/newsroom/press-releases
- SEC RSS Feeds: https://www.sec.gov/about/rss-feeds
- U.S. Treasury Press Releases: https://home.treasury.gov/news/press-releases
- CNBC / Reuters / Google News 可作为市场新闻补充，但要注意版权和引用边界。

第一版不做：

- 不做投资建议。
- 不做买卖推荐。
- 不保证完整覆盖所有市场。
- 不在没有来源的情况下编“今日新闻”。

## 自有模型接入建议

可以接自己的模型，建议分三层。

### 方案 A：Xiaozhi 继续负责对话，MCP 只提供工具

这是当前形态。

优点：

- 改动小。
- 设备链路稳定。
- 我们只需要维护工具层。

缺点：

- 模型选择受 Xiaozhi 端限制。
- 复杂多轮任务和个性化控制较弱。

### 方案 B：Bridge 调用自己的模型生成工具结果

例如 `finance_daily_briefing` 内部调用自己的模型，把新闻列表润色成播报稿。

优点：

- 不需要替换整个机器人对话链路。
- 可以逐步把关键能力迁到自己的模型。

缺点：

- Xiaozhi 外层模型仍会二次处理结果。
- 需要控制输出，避免重复总结或改写事实。

### 方案 C：自己做 Agent Server

Xiaozhi 只做语音入口，所有意图识别、工具调用、回复生成都走自己的服务。

优点：

- 完全可控。
- 可以接自己的模型、RAG、权限系统、审计系统。

缺点：

- 工程量最大。
- 要自己处理对话状态、工具路由、失败恢复和安全策略。

建议路线：

1. 当前继续用方案 A。
2. 财经播报先用方案 B。
3. 等工具稳定后，再评估方案 C。

## 腾讯云部署取舍

不要把真正能执行本机命令的 Codex Bridge 直接暴露到腾讯云公网。

更合理的架构是：

```text
StackChan -> Xiaozhi Cloud -> Tencent Cloud control plane -> Mac worker -> Local MCP tools
```

腾讯云适合做：

- 在线状态。
- 任务队列。
- 权限审批。
- 项目白名单管理。
- 日志和审计。
- 财经数据定时抓取。
- 每日播报缓存。

Mac 适合做：

- 访问本机项目。
- 调用 Codex。
- 运行本地命令。
- 操作本地文件。

## 本项目下一步路线

### Phase 1：机器人实用播报

- `finance_daily_briefing`
- 天气 / 时间 / 日程
- 朗读友好的短文本输出
- 表情状态联动

### Phase 2：项目只读助理

- `codex_list_projects`
- 项目状态摘要
- 最近任务状态
- 只读项目问答
- 只读 Codex 执行

### Phase 3：权限和审批

- 写操作必须确认。
- `workspace-write` 单独开关。
- 操作审计。
- 失败恢复。

### Phase 4：云端控制层

- 腾讯云状态面板。
- Mac worker 心跳。
- 任务队列。
- 财经播报缓存。

### Phase 5：自有模型

- 财经播报接自有模型润色。
- 项目问答接自有模型或 RAG。
- 最后再考虑完整 Agent Server。

## 当前判断

我们不应该重造 StackChan / Xiaozhi 的底层链路。更好的方向是：

1. 继续用 Xiaozhi endpoint 和 `xiaozhi-client`。
2. 本项目专注 MCP 工具层和权限层。
3. 财经播报作为第一个非 Codex 的“家庭实用能力”。
4. Codex 从核心能力降级为“项目工具之一”。
5. 后续逐步接自有模型，而不是一开始替换全部对话链路。
