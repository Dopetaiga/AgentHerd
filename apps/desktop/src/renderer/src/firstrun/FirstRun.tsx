// The first run: one question per screen, over the whole window, with Back and Continue.
// Order: 欢迎 → 绑定飞书 → 添加模型服务 → 给主管选模型 → 完成. Every step after 欢迎 can wait.

import { ArrowRight, Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useFeishuSetup } from "../components/FeishuSetup";
import { Logo } from "../components/Logo";
import {
  ProviderChoiceList,
  ServiceKeyFields,
  ServiceModelFields,
  useServiceDraft,
} from "../components/ServiceDraft";
import { Button } from "../components/ui";
import { useApp } from "../store";
import {
  BODY,
  DoneBody,
  FeishuBody,
  HerderBody,
  ServiceListBody,
  useHerderChoice,
} from "./FirstRunSteps";
import "./first-run.css";

type Step = "welcome" | "feishu" | "service" | "herder" | "done";
/** The parts of the service step: the saved list, then the picker, the key and the models. */
type ServicePart = "list" | "pick" | "key" | "models";

const ORDER: readonly Step[] = ["welcome", "feishu", "service", "herder", "done"];
/** The steps that get a dot; 欢迎 does not. */
const DOTTED: readonly Step[] = ["feishu", "service", "herder", "done"];

/** Runs a state change as a view transition where the browser has them (fade and blur). */
function transition(change: () => void) {
  if (typeof document.startViewTransition !== "function") {
    change();
    return;
  }
  document.startViewTransition(() => flushSync(change));
}

function Dots({ step }: { step: Step }) {
  const at = DOTTED.indexOf(step);
  return (
    <div className="ah-fr-dots flex h-1.5 items-center gap-1.5" aria-hidden>
      {DOTTED.map((s, i) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === at ? "w-[22px] bg-ink" : i < at ? "w-1.5 bg-ink-muted" : "w-1.5 bg-line-strong"
          }`}
        />
      ))}
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <h1 className="font-semibold text-2xl text-ink tracking-[-0.4px]">{title}</h1>
      <p className="max-w-[420px] text-ink-muted text-base leading-6">{hint}</p>
    </div>
  );
}

export function FirstRun() {
  const finish = useApp((s) => s.finishFirstRun);
  const services = useApp((s) => s.models?.services ?? []);
  const herderRef = useApp((s) => s.models?.roles.herder);
  const flow = useFeishuSetup();
  const draft = useServiceDraft();
  const herder = useHerderChoice();
  const [step, setStep] = useState<Step>(
    window.location.hash === "#onboarding-done" ? "done" : "welcome",
  );
  const [part, setPart] = useState<ServicePart>(services.length > 0 ? "list" : "pick");
  const running = useRef(flow.running);
  running.current = flow.running;

  // A binding still running when the flow closes is cancelled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the flow closes
  useEffect(
    () => () => {
      if (running.current) void flow.cancel();
    },
    [],
  );

  const go = (next: Step, nextPart?: ServicePart) =>
    transition(() => {
      if (step === "feishu" && next !== "feishu" && flow.running) void flow.cancel();
      setStep(next);
      if (next === "service") setPart(nextPart ?? (services.length > 0 ? "list" : "pick"));
    });
  const goPart = (next: ServicePart) => transition(() => setPart(next));
  const forward = () => go(ORDER[ORDER.indexOf(step) + 1] ?? "done");

  const back = () => {
    if (step === "service" && part === "models") return goPart("key");
    if (step === "service" && part === "key") return goPart("pick");
    if (step === "service" && part === "pick" && services.length > 0) return goPart("list");
    if (step === "herder") return go("service");
    go(ORDER[ORDER.indexOf(step) - 1] ?? "welcome");
  };

  const saveService = async () => {
    if (await draft.save()) go("herder");
  };

  let title = "";
  let hint: ReactNode = "";
  let body: ReactNode = null;
  let primary = "继续";
  let ready = true;
  let reason: string | undefined;
  let onPrimary = forward;
  let busy = false;

  switch (step) {
    case "welcome":
      break;
    case "feishu":
      title = "绑定飞书";
      hint = "扫一次码，AgentHerd 会建好机器人。之后进度和审批请求都发到飞书。";
      body = <FeishuBody flow={flow} />;
      ready = flow.bound;
      reason = ready ? undefined : "扫码绑定后才能继续";
      break;
    case "service":
      if (part === "list") {
        title = "添加模型服务";
        hint = "已添加的模型服务。可以直接继续，也可以再加一个。";
        body = <ServiceListBody onAdd={() => goPart("pick")} />;
      } else if (part === "pick") {
        title = "添加模型服务";
        hint = "主管要用一个大模型来读懂任务。选择你有 Key 的服务。";
        body = (
          <div className={BODY}>
            <ProviderChoiceList
              draft={draft}
              mode="select"
              listClassName="max-h-[max(150px,calc(100vh-420px))]"
            />
          </div>
        );
        ready = draft.choice !== null;
        reason = ready ? undefined : "先选一个服务";
        onPrimary = () => goPart("key");
      } else if (part === "key") {
        title =
          draft.choice?.kind === "custom"
            ? "连接 OpenAI 兼容服务"
            : `填写 ${draft.choiceName} 的 Key`;
        hint = "Key 只保存在这台电脑的系统钥匙串里。";
        body = (
          <div className={BODY}>
            <ServiceKeyFields draft={draft} showId={false} />
          </div>
        );
        onPrimary = () => {
          if (draft.checkDetails()) goPart("models");
        };
      } else {
        title = "选择要启用的模型";
        hint = "之后可以在「模型」页随时修改。";
        body = (
          <div className={`${BODY} max-h-[max(160px,calc(100vh-400px))] overflow-y-auto`}>
            <ServiceModelFields draft={draft} />
          </div>
        );
        primary = "保存";
        ready = draft.models.length > 0;
        reason = ready ? undefined : "至少选一个模型";
        busy = draft.saving;
        onPrimary = () => void saveService();
      }
      break;
    case "herder":
      title = "给主管选模型";
      hint = "主管在飞书里回答你、帮你开任务、跟进进度。它不会替你批准任何请求。";
      body = <HerderBody herder={herder} />;
      ready = herderRef !== undefined && herder.testing === null;
      reason = herderRef === undefined ? "先选一个模型" : undefined;
      break;
    case "done":
      title = "准备好了";
      hint = "没完成的项目，之后在「设置」和「模型」页都能补上。";
      body = <DoneBody />;
      primary = "进入 AgentHerd";
      onPrimary = finish;
      break;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready && !busy) onPrimary();
  };

  return (
    <div className="ah-fr fixed inset-0 z-30 flex flex-col bg-canvas text-ink">
      <div className="app-drag flex h-12 shrink-0 items-center justify-end px-4">
        {step !== "done" && (
          <button
            type="button"
            onClick={finish}
            className="rounded-md px-2 py-1 text-ink-dim text-sm hover:bg-hover hover:text-ink-2"
          >
            跳过引导
          </button>
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-8"
      >
        {step === "welcome" ? (
          <div className="ah-fr-step my-auto flex flex-col items-center gap-7 text-center">
            <Logo size={64} />
            <div className="flex flex-col items-center gap-3">
              <h1 className="font-semibold text-[30px] text-ink tracking-[-0.6px]">
                欢迎使用 AgentHerd
              </h1>
              <p className="max-w-[400px] text-base text-ink-muted leading-6">
                AgentHerd 在后台看着你的编程 Agent：普通请求替你放行，要紧的发到飞书等你批准。
              </p>
            </div>
            <Button variant="primary" type="submit" className="mt-2 h-10 min-w-[200px] text-base">
              开始 <ArrowRight size={15} />
            </Button>
          </div>
        ) : (
          <div className="my-auto flex w-full flex-col items-center gap-7 py-4">
            <Dots step={step} />
            <div
              key={`${step}/${part}`}
              className="ah-fr-step flex w-full flex-col items-center gap-7"
            >
              <Heading title={title} hint={hint} />
              {body}
              {step === "service" && part !== "list" && draft.error !== null && (
                <p className={`${BODY} -mt-3 text-danger-text`}>{draft.error}</p>
              )}
            </div>
            <div className="ah-fr-actions flex w-full max-w-[320px] flex-col items-center gap-3">
              <div className="flex w-full gap-2">
                <Button className="h-10 flex-1 text-base" onClick={back} disabled={busy}>
                  返回
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  className="h-10 flex-[2] text-base"
                  disabled={!ready || busy}
                  title={reason}
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {primary}
                </Button>
              </div>
              {step !== "done" && (
                <button
                  type="button"
                  onClick={forward}
                  className="text-ink-dim text-sm hover:text-ink-2"
                >
                  稍后再说
                </button>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
