// "添加服务": one dialog with two views (ADR 0021). First a searchable grid of services; a
// click opens one form with the key and the models. The actions sit in the header; there are
// no steps and no 上一步 / 下一步.

import { ChevronLeft, Loader2 } from "lucide-react";
import { useState } from "react";
import { useServiceDraft } from "./ServiceDraft";
import { ServiceChooser, ServiceForm } from "./ServiceForm";
import { Button, Modal } from "./ui";

export function AddServiceDialog({
  onClose,
  initialProvider,
  initialModels,
}: {
  onClose: () => void;
  /** Dev preview only: open the form of this provider ("custom" for an address) at once. */
  initialProvider?: string;
  /** Dev preview only: the models chosen when the form opens. */
  initialModels?: string[];
}) {
  const draft = useServiceDraft();
  const [view, setView] = useState<"choose" | "form">("choose");
  const [opened, setOpened] = useState(false);

  if (!opened && initialProvider !== undefined) {
    const p = draft.shown.find((x) => x.provider === initialProvider);
    if (initialProvider === "custom" || p !== undefined) {
      setOpened(true);
      draft.pick(p === undefined ? { kind: "custom" } : { kind: "builtin", provider: p });
      if (initialModels !== undefined) draft.setPicked(initialModels);
      setView("form");
    }
  }

  const save = async () => {
    if (await draft.save()) onClose();
  };

  if (view === "choose" || draft.choice === null) {
    return (
      <Modal
        size="large"
        title="添加服务"
        description="选择模型服务，然后填写 Key 并选模型。"
        onClose={onClose}
        actions={<Button onClick={onClose}>取消</Button>}
      >
        <ServiceChooser draft={draft} onPicked={() => setView("form")} />
      </Modal>
    );
  }

  return (
    <Modal
      size="large"
      title={draft.choice.kind === "builtin" ? `添加 ${draft.choiceName}` : "添加 OpenAI 兼容服务"}
      description={
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-accent-text hover:underline disabled:opacity-50"
          disabled={draft.saving}
          onClick={() => setView("choose")}
        >
          <ChevronLeft size={13} />
          更换服务
        </button>
      }
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose} disabled={draft.saving}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={draft.saving || draft.problem !== null}
            title={draft.problem ?? undefined}
          >
            {draft.saving && <Loader2 size={14} className="animate-spin" />}保存
          </Button>
        </>
      }
    >
      <ServiceForm draft={draft} />
    </Modal>
  );
}
