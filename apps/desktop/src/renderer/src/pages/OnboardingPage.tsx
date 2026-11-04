// 引导: bind Feishu, add a model service, choose the Herder's model. Every step can be skipped.

import { Check } from "lucide-react";
import { useState } from "react";
import { FeishuSetup } from "../components/FeishuSetup";
import { RolePicker } from "../components/RolePicker";
import { Button, Card } from "../components/ui";
import { useApp } from "../store";
import { ServiceList } from "./ModelsPage";

const STEPS = [
  { title: "绑定飞书", hint: "任务进度和审批请求都会发到飞书" },
  { title: "配置模型", hint: "添加一个模型服务和它的 Key" },
  { title: "给主管选模型", hint: "主管用它跟进任务、回答你" },
] as const;

export function OnboardingPage() {
  const bound = useApp((s) => s.status?.channel.bound ?? false);
  const serviceCount = useApp((s) => s.models?.services.length ?? 0);
  const herderChosen = useApp((s) => s.models?.roles.herder !== undefined);
  const setPage = useApp((s) => s.setPage);
  const [step, setStep] = useState(() => (!bound ? 0 : serviceCount === 0 ? 1 : 2));
  const done = [bound, serviceCount > 0, herderChosen];
  const last = step === STEPS.length - 1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="font-semibold text-xl text-zinc-900 dark:text-zinc-100">
          欢迎使用 AgentHerd
        </h1>
        <p className="mt-1 text-sm text-zinc-500">三步准备好，之后在飞书里管理你的 Agent。</p>
      </div>

      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                i === step
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-medium text-xs ${
                  done[i]
                    ? "bg-emerald-500 text-white"
                    : i === step
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                }`}
              >
                {done[i] ? <Check size={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                  {s.title}
                </span>
                <span className="block truncate text-xs text-zinc-500">{s.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <FeishuSetup />
        </Card>
      )}
      {step === 1 && <ServiceList />}
      {step === 2 && (
        <Card>
          <RolePicker />
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => setPage("tasks")}>
          跳过引导
        </Button>
        <span className="flex-1" />
        {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
        {last ? (
          <Button variant="primary" onClick={() => setPage("tasks")}>
            完成
          </Button>
        ) : (
          <Button variant={done[step] ? "primary" : "secondary"} onClick={() => setStep(step + 1)}>
            {done[step] ? "下一步" : "跳过这一步"}
          </Button>
        )}
      </div>
    </div>
  );
}
