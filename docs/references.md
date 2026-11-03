# 参考项目

AgentHerd 只参考下列项目的设计，不复制它们的代码。

| 项目 | 许可证 | 参考什么 |
| --- | --- | --- |
| [PI-Desktop](https://github.com/vastsa/PI-Desktop) | LGPL-3.0 | Electron + electron-vite + React + Tailwind + zustand 的桌面端外观和交互：侧栏、设置页、权限卡片、通知中心、新手引导 |
| [OpenBot](https://github.com/nightly-labs/openbot) | PolyForm Noncommercial 1.0.0 | 本地驱动 Codex App Server、Claude Code 和 ACP Agent 的方式；Slack / Telegram / Discord 等 IM 接入 |
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | MIT | “尽量少占用人的注意力”的原则、observe 模式、面板只显示需要人处理的事、飞书 Source 设计 |
| [飞书一键创建智能体应用](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/overview) | — | `@larksuiteoapi/node-sdk` 的 `registerApp`：扫一次码拿到 App ID / Secret，长连接接收消息和卡片回调 |
| botmux、cc-connect | — | 飞书接入的安装体验 |

注意：PI-Desktop（LGPL）和 OpenBot（非商业许可）的源码不能复制进本仓库。
