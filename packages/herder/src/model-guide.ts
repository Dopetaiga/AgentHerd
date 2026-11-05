// The model guide the Herder reads when it picks a model for a task (ADR 0026). AgentHerd ships a
// default; the owner can replace it on the 主管 page. It is advice, not a rule.

/** Written 2026-11-05 from pi-ai 1.5.0's catalog. Update it when the field changes. */
export const DEFAULT_MODEL_GUIDE = `模型选择参考（2026-11，按能力从强到弱）：

最强，用于难题、大改动、架构设计、排查疑难 bug：
- Claude Opus（最新是 claude-opus-5-5）：编程最强，首选
- GPT 最新旗舰（gpt-6.1 系列）、Gemini Pro 最新版：接近 Opus

均衡，用于普通功能开发、修 bug、写测试：
- Claude Sonnet（最新是 claude-sonnet-5-5）
- DeepSeek V4 Pro、Kimi K3.1 Pro、GLM 5.3

便宜快，用于小改动、查资料、改文案、跑命令看结果：
- DeepSeek Flash、Gemini Flash、GLM 5.3 Flash、MiniMax M3.1 Flash

挑法：
- 主人点名用哪个模型，就用哪个。
- 不确定难度时，选均衡档。
- 同一档里优先选主人列表里排在前面的服务。`;

/** The guide in effect: the owner's text when set, else the default. */
export function effectiveModelGuide(ownerText: string | undefined): string {
  const text = ownerText?.trim();
  return text === undefined || text === "" ? DEFAULT_MODEL_GUIDE : text;
}
