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
- **支持 ACP 的 Agent 都能接入。** AgentHerd 通过
  [Agent Client Protocol](https://agentclientprotocol.com) 启动 Agent：Claude Code、Codex、
  Gemini CLI、OpenCode、DeepSeek Harness 等。新加一个 Agent 只要写一行配置。
- **一套规则，处处生效。** 你的规则还会编译成各个 Agent 自己的权限配置，
  所以你在终端里自己开的会话也按这套规则走。
- **给 Agent 们配一个秘书。** 主管（Herder）是一个用轻量模型的
  [Pi](https://github.com/earendil-works/pi) Agent：接你的消息、派任务、把你转接到任意任务、
  维护置顶的任务看板，每个 Agent 做完都告诉你它做了什么。你的原话原样交给 Agent。
- **审批分层。** 防护清单 → 你的规则 → 用你最强模型的审核员（Reviewer）→ 你。
  拿不准或者出错时就问你，绝不会猜“允许”。主管本身不能批准任何请求。
- **信任逐步建立。** 默认是 `observe` 模式：只给建议，并统计建议和你实际的回答有多一致。
  数据证明可靠后，再由你开启 `assist` 和 `auto`。
- **只在本地运行。** 没有 AgentHerd 服务器，密钥保存在系统钥匙串里。

## 试用（M1）

M1 运行一个脚本化的模拟 Agent，把它的审批请求发到你的飞书。需要 Node 22.18+ 和 pnpm。

```bash
pnpm install
node packages/cli/bin/agentherd.ts setup feishu   # 用飞书扫码
node packages/cli/bin/agentherd.ts run --script packages/mock-agent/scripts/approve.yaml /tmp/demo "run the tests"
```

在卡片上点 **Allow**。`node packages/cli/bin/agentherd.ts status` 可以看到这次决定。

装了 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的话，可以跑真实 Agent。
DSH 以只读沙箱模式运行，每次写文件都会先问你：

```bash
node packages/cli/bin/agentherd.ts run --profile dsh /tmp/demo "Create out.txt containing hello"
```

想让主管回答普通消息，先加一个模型服务并给主管选模型（Key 从标准输入读取，存进钥匙串）：

```bash
node packages/cli/bin/agentherd.ts model add deepseek --models deepseek-flash
node packages/cli/bin/agentherd.ts model use herder deepseek/deepseek-flash
node packages/cli/bin/agentherd.ts start
```

### 桌面应用（M2，开发中）

应用里可以绑定飞书、添加模型服务和 Key、给主管选模型，并查看任务和待处理的请求。它会自己启动后台服务，
或者连上用 `agentherd start` 启动的那个。

```bash
pnpm --filter @agentherd/desktop build
pnpm --filter @agentherd/desktop start
```

## 文档

- [规格](docs/spec/00-baseline.md)：AgentHerd 做什么
- [ADR](docs/adr/README.md)：为什么这样设计
- [计划](plans/README.md)：怎么一步步实现
- [参考项目](docs/references.md)：我们参考了哪些项目
- [AGENTS.md](AGENTS.md)：贡献者和 Coding Agent 要遵守的规则

## 许可证

[MIT](LICENSE)
