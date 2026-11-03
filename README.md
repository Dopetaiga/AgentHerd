# AgentHerd

> Herd your coding agents. Only get pinged when it matters.

同时跑多个 Claude Code / Codex 会话时，AgentHerd 在桌面端常驻，替你看住它们：
低风险、有先例的审批和提问由主管（Herder）自动处理，真正需要你拍板的事才通过飞书找你。

> 状态：设计阶段，还没有可运行的代码。

## 设计要点（草案）

- **飞书是主界面**：审批卡片、提问卡片、派活、每日摘要。扫一次码即可接入，不需要手动创建和发布应用。
- **桌面端（Electron）负责配置和观察**：扫码接入、一键安装 Hook、各会话实时状态、规则与决策历史、托盘常驻。
- **主管基于 [Pi](https://github.com/earendil-works/pi)**：决策流水线 L0 规则 → L1 低成本分类 → L2 只读 Pi Agent → L3 找人。
- **v1 被管的 Agent**：Claude Code（PermissionRequest / Notification / Stop Hook）和 Codex。
- **少占注意力**：一次只问一件事；默认先只给建议（observe），确认可靠后再放开自动决策；所有决策可审计、可撤销。

参考过的项目见 [docs/references.md](docs/references.md)。

## License

[MIT](LICENSE)
