// The parts of adding a model service: a searchable grid of services to choose from, then one
// form with the key fields on top and the two model panes below (see ModelPanes).

import { Check, Globe, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { providerName } from "./labels";
import { ModelPanes } from "./ModelPanes";
import { ProbeButton } from "./ModelProbe";
import { type ServiceChoice, type ServiceDraft, sameChoice } from "./ServiceDraft";
import { IconTile, inputClass } from "./ui";

/** Every service the owner can add, as tiles. A click chooses it and moves on to the form. */
export function ServiceChooser({
  draft,
  onPicked,
  autoFocus = true,
}: {
  draft: ServiceDraft;
  onPicked: () => void;
  autoFocus?: boolean;
}) {
  const choose = (c: ServiceChoice) => {
    draft.pick(c);
    onPicked();
  };
  const first = draft.shown[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0">
        <Search size={14} className="absolute top-[9px] left-2.5 text-ink-dim" />
        <input
          autoFocus={autoFocus}
          className={`${inputClass} pl-8`}
          placeholder="搜索服务商"
          aria-label="搜索服务商"
          spellCheck={false}
          value={draft.query}
          onChange={(e) => draft.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            choose(first !== undefined ? { kind: "builtin", provider: first } : { kind: "custom" });
          }}
        />
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-2">
          {draft.shown.map((p) => {
            const c: ServiceChoice = { kind: "builtin", provider: p };
            const name = providerName(p.provider);
            return (
              <Tile
                key={p.provider}
                current={sameChoice(draft.choice, c)}
                icon={<span className="font-semibold text-sm">{name.slice(0, 1)}</span>}
                title={name}
                detail={`${p.models.length} 个模型`}
                onClick={() => choose(c)}
              />
            );
          })}
          <Tile
            current={sameChoice(draft.choice, { kind: "custom" })}
            icon={<Globe size={15} strokeWidth={1.75} />}
            title="OpenAI 兼容地址"
            detail="第三方、中转或本地 Ollama"
            onClick={() => choose({ kind: "custom" })}
          />
        </div>
        {draft.shown.length === 0 && (
          <p className="px-1 pt-3 text-ink-muted text-sm">
            没有匹配的服务商。不在列表里的服务，可以用 OpenAI 兼容地址添加。
          </p>
        )}
      </div>
    </div>
  );
}

function Tile({
  current,
  icon,
  title,
  detail,
  onClick,
}: {
  current: boolean;
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current || undefined}
      className={`flex min-h-14 w-full items-center gap-3 rounded-lg border bg-surface px-3 py-2 text-left transition-colors hover:bg-control-hover ${
        current ? "border-accent" : "border-line hover:border-line-strong"
      }`}
    >
      <IconTile tone={current ? "blue" : "gray"}>{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{title}</span>
        <span className="block truncate text-ink-muted text-sm">{detail}</span>
      </span>
      {current && <Check size={15} className="shrink-0 text-accent-text" />}
    </button>
  );
}

/** A label above a control, compact enough to sit in a row of fields. */
export function SmallField({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block min-w-0">
      <span className="mb-1 ml-0.5 block font-medium text-ink-2 text-sm">{label}</span>
      {children}
    </label>
  );
}

/** One line under the fields: the error when there is one, otherwise a hint. */
export function FieldNote({
  error,
  hint,
  end,
}: {
  error: string | null;
  hint: string;
  end?: ReactNode;
}) {
  return (
    <div className="-mt-1 flex min-h-5 shrink-0 items-center gap-3 text-sm">
      <span
        className={`selectable min-w-0 flex-1 truncate ${error !== null ? "text-danger-text" : "text-ink-muted"}`}
        title={error ?? hint}
      >
        {error ?? hint}
      </span>
      {end}
    </div>
  );
}

/** The key fields of the chosen service, in one row; ID and name of a built-in are behind 高级. */
function ServiceFields({ draft, allowAdvanced }: { draft: ServiceDraft; allowAdvanced: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const custom = draft.choice?.kind === "custom";
  const more = allowAdvanced && advanced;
  const columns = custom
    ? more
      ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)]"
      : "grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)]"
    : more
      ? "grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"
      : "grid-cols-1";
  // Problems show live once the owner typed in a field or tried to save.
  const shownError = draft.touched || draft.error !== null ? draft.detailsProblem() : null;

  const keyField = (
    <SmallField label="API Key">
      <input
        autoFocus={!custom}
        type="password"
        autoComplete="off"
        className={`${inputClass} font-mono`}
        placeholder={custom ? "sk-…（本地服务可留空）" : "sk-…（留空则使用环境变量）"}
        value={draft.key}
        onChange={(e) => draft.setKey(e.target.value)}
      />
    </SmallField>
  );
  const nameField = (
    <SmallField label="名称">
      <input
        autoFocus={custom}
        className={inputClass}
        placeholder="例如：公司网关"
        value={draft.name}
        onChange={(e) => (custom ? draft.onName(e.target.value) : draft.setName(e.target.value))}
      />
    </SmallField>
  );
  const idField = (
    <SmallField label="ID">
      <input
        className={`${inputClass} font-mono`}
        spellCheck={false}
        value={draft.id}
        onChange={(e) => draft.setId(e.target.value)}
      />
    </SmallField>
  );

  return (
    <>
      <div className={`grid shrink-0 items-start gap-3 max-[720px]:grid-cols-2 ${columns}`}>
        {custom ? (
          <>
            {nameField}
            <SmallField label="Base URL">
              <input
                className={`${inputClass} font-mono`}
                placeholder="https://host/v1"
                spellCheck={false}
                value={draft.baseUrl}
                onChange={(e) => draft.setBaseUrl(e.target.value)}
              />
            </SmallField>
            {keyField}
            {more && idField}
            {more && (
              <SmallField label="接口格式">
                <select
                  className={inputClass}
                  value={draft.api}
                  onChange={(e) => draft.setApi(e.target.value as typeof draft.api)}
                >
                  <option value="openai-completions">OpenAI 兼容</option>
                  <option value="anthropic-messages">Anthropic 兼容</option>
                </select>
              </SmallField>
            )}
          </>
        ) : (
          <>
            {keyField}
            {more && nameField}
            {more && idField}
          </>
        )}
      </div>
      <FieldNote
        error={shownError ?? (custom ? draft.probe.error : null)}
        hint={
          custom
            ? (draft.probe.note ??
              "Base URL 通常以 /v1 结尾，本地 Ollama 是 http://localhost:11434/v1。Key 只保存在本机。")
            : "Key 只保存在本机 secrets.json，保存后不再显示。"
        }
        end={
          allowAdvanced && (
            <button
              type="button"
              className="shrink-0 text-accent-text hover:underline"
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced ? "收起高级" : custom ? "高级：ID" : "高级：名称和 ID"}
            </button>
          )
        }
      />
    </>
  );
}

/** The form of the chosen service: its key fields, then the models in two panes. */
export function ServiceForm({
  draft,
  allowAdvanced = true,
}: {
  draft: ServiceDraft;
  /** The first run keeps the default ID and name of a service and hides them. */
  allowAdvanced?: boolean;
}) {
  const choice = draft.choice;
  if (choice === null) return null;
  return (
    <>
      <ServiceFields key={choice.kind} draft={draft} allowAdvanced={allowAdvanced} />
      <ModelPanes
        key={choice.kind === "builtin" ? choice.provider.provider : "custom"}
        options={choice.kind === "builtin" ? choice.provider.models : draft.probe.models}
        selected={draft.picked}
        onChange={draft.setPicked}
        disabled={draft.saving}
        headerAction={
          choice.kind === "custom" ? (
            <ProbeButton
              running={draft.probe.running}
              disabled={draft.saving || draft.probeProblem() !== null}
              title={draft.probeProblem() ?? "从服务的 /models 接口读取模型列表"}
              onClick={() => void draft.probeModels()}
            />
          ) : undefined
        }
      />
    </>
  );
}
