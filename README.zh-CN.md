# AgentHerd

> 管好你的一群 Coding Agent，只在真正需要你的时候打扰你。

[English](README.md) | 简体中文

同时跑 Claude Code、Codex、OpenCode、Gemini CLI 这些 Coding Agent 时，它们会不断停下来：
要你批准一条命令，问你一个问题，或者已经做完、卡住了。AgentHerd 在桌面端替你看着它们。
有明确先例的常规请求由它处理；真正需要你拍板的事，才在聊天软件里找你，而且一次只找一件。

> **状态：** 设计阶段，还没有可运行的代码。请先看[基线规格](docs/spec/00-baseline.md)。

## 工作方式

- **用聊天软件当遥控器。** 在手机上通过卡片批准、拒绝或回答，也可以发一条消息派新任务。
  第一个支持的是飞书（Lark），扫一次码就能接入。
- **所有 Agent 用同一套模型管理。** 适配器既能接入你自己启动的会话（通过 Hook），
  也能由 AgentHerd 启动新会话（通过 app-server、ACP 或 SDK）。
- **主管（Herder）分层决策。** 防护清单 → 你的规则 → 小模型 → 只读的
  [Pi](https://github.com/earendil-works/pi) Agent → 你。拿不准或者出错时，它会问你，
  或者让 Agent 自己问你，绝不会猜“允许”。
- **信任逐步建立。** 默认是 `observe` 模式：只给建议，并统计建议和你实际的回答有多一致。
  数据证明可靠后，再由你开启 `assist` 和 `auto`。
- **只在本地运行。** 没有 AgentHerd 服务器，密钥保存在系统钥匙串里。

## 文档

- [规格](docs/spec/00-baseline.md)：AgentHerd 做什么
- [ADR](docs/adr/README.md)：为什么这样设计
- [计划](plans/README.md)：怎么一步步实现
- [参考项目](docs/references.md)：我们参考了哪些项目
- [AGENTS.md](AGENTS.md)：贡献者和 Coding Agent 要遵守的规则

## 许可证

[MIT](LICENSE)
