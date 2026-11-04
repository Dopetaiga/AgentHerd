// "添加服务": choose the service first, then the key, then the models (ADR 0021).

import { Loader2 } from "lucide-react";
import { useState } from "react";
import {
  ProviderChoiceList,
  ServiceKeyFields,
  ServiceModelFields,
  useServiceDraft,
} from "./ServiceDraft";
import { Button, Modal } from "./ui";

export function AddServiceDialog({ onClose }: { onClose: () => void }) {
  const draft = useServiceDraft();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const save = async () => {
    if (await draft.save()) onClose();
  };

  const title =
    step === 1
      ? "添加服务"
      : draft.choice?.kind === "builtin"
        ? `添加 ${draft.choiceName}`
        : "添加 OpenAI 兼容服务";

  const footer =
    step === 1 ? (
      <Button onClick={onClose}>取消</Button>
    ) : (
      <>
        <span className="mr-auto text-ink-muted text-sm">第 {step - 1} / 2 步</span>
        <Button onClick={() => setStep(step === 3 ? 2 : 1)} disabled={draft.saving}>
          上一步
        </Button>
        {step === 2 ? (
          <Button variant="primary" onClick={() => draft.checkDetails() && setStep(3)}>
            下一步
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={save}
            disabled={draft.saving || draft.models.length === 0}
          >
            {draft.saving && <Loader2 size={14} className="animate-spin" />}保存
          </Button>
        )}
      </>
    );

  return (
    <Modal
      title={title}
      description={step === 1 ? "先选择模型服务。" : step === 3 ? "选择要启用的模型。" : undefined}
      onClose={onClose}
      footer={footer}
      wide
    >
      {/* In the dialog a click on a service moves on to its key at once. */}
      {step === 1 && (
        <ProviderChoiceList draft={draft} mode="navigate" onPicked={() => setStep(2)} />
      )}
      {step === 2 && draft.choice !== null && <ServiceKeyFields draft={draft} />}
      {step === 3 && draft.choice !== null && <ServiceModelFields draft={draft} />}
      {step !== 1 && draft.error !== null && <p className="mt-3 text-danger-text">{draft.error}</p>}
    </Modal>
  );
}
