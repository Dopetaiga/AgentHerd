// Picks the models a service turns on, in two panes side by side (like pi-desktop):
// the service's models on the left, what is chosen on the right. Both panes scroll on
// their own, so the dialog keeps its size however many models a service has.

import { Plus, Search, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { parseModelList } from "./labels";
import { Button, inputClass } from "./ui";

type ModelOption = { id: string; name: string };

const lower = (s: string) => s.toLowerCase();

export function ModelPanes({
  options,
  selected,
  onChange,
  disabled = false,
}: {
  /** The service's catalog; empty for an OpenAI-compatible service. */
  options: ModelOption[];
  selected: string[];
  onChange: (models: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const hasCatalog = options.length > 0;

  const chosen = useMemo(() => new Set(selected.map(lower)), [selected]);
  const names = useMemo(() => new Map(options.map((o) => [lower(o.id), o.name])), [options]);

  // Models already chosen but missing from the catalog stay on the list, first.
  const rows = useMemo(() => {
    const extra = selected.filter((id) => !names.has(lower(id))).map((id) => ({ id, name: id }));
    return [...extra, ...options];
  }, [options, selected, names]);

  const q = query.trim().toLowerCase();
  const shown =
    q === "" ? rows : rows.filter((o) => lower(o.id).includes(q) || lower(o.name).includes(q));
  const shownChosen = shown.filter((o) => chosen.has(lower(o.id))).length;
  const allShown = shown.length > 0 && shownChosen === shown.length;
  const someShown = shownChosen > 0 && !allShown;

  const toggle = (id: string) => {
    onChange(
      chosen.has(lower(id)) ? selected.filter((m) => lower(m) !== lower(id)) : [...selected, id],
    );
  };

  /** Selects or clears every row the search shows; hidden rows keep their state. */
  const toggleShown = (on: boolean) => {
    const ids = new Set(shown.map((o) => lower(o.id)));
    if (!on) {
      onChange(selected.filter((m) => !ids.has(lower(m))));
      return;
    }
    onChange([...selected, ...shown.filter((o) => !chosen.has(lower(o.id))).map((o) => o.id)]);
  };

  /** Adds the typed ids; a comma or newline separated paste works too. */
  const add = () => {
    const ids = parseModelList(typed);
    if (ids.length === 0) {
      setAddError("请填写模型 ID");
      return;
    }
    const seen = new Set(chosen);
    const next = [...selected];
    for (const id of ids) {
      if (seen.has(lower(id))) continue;
      seen.add(lower(id));
      next.push(id);
    }
    if (next.length === selected.length) {
      setAddError(ids.length === 1 ? `“${ids[0]}” 已经选了` : "这些模型都已经选了");
      return;
    }
    onChange(next);
    setTyped("");
    setAddError(null);
  };

  const addField = (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          className={`${inputClass} min-w-0 flex-1 font-mono`}
          placeholder={hasCatalog ? "列表里没有？填写模型 ID" : "模型 ID，例如 qwen3-coder-plus"}
          aria-label="模型 ID"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (addError !== null) setAddError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <Button onClick={add} disabled={disabled} className="h-8">
          <Plus size={13} />
          添加
        </Button>
      </div>
      {(addError !== null || !hasCatalog) && (
        <span
          className={`ml-0.5 truncate text-sm ${addError !== null ? "text-danger-text" : "text-ink-muted"}`}
        >
          {addError ?? "填写服务商给的模型 ID，按回车添加"}
        </span>
      )}
    </div>
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 max-[720px]:grid-cols-1">
      <Pane>
        <div className="flex h-7 shrink-0 items-center gap-2.5 px-0.5">
          {hasCatalog && shown.length > 0 && (
            <input
              type="checkbox"
              className="ah-check"
              checked={allShown}
              disabled={disabled}
              ref={(el) => {
                if (el !== null) el.indeterminate = someShown;
              }}
              aria-label={allShown ? "取消全选列出的模型" : "全选列出的模型"}
              title={allShown ? "取消全选列出的模型" : "全选列出的模型"}
              onChange={(e) => toggleShown(e.target.checked)}
            />
          )}
          <h4 className="min-w-0 flex-1 truncate font-medium text-ink">
            {hasCatalog ? "服务提供的模型" : "手动添加模型"}
          </h4>
          {hasCatalog && <span className="text-ink-muted text-sm">共 {options.length} 个</span>}
        </div>
        {hasCatalog ? (
          <>
            <div className="relative shrink-0">
              <Search size={14} className="absolute top-[9px] left-2.5 text-ink-dim" />
              <input
                className={`${inputClass} pl-8`}
                placeholder="搜索模型"
                aria-label="搜索模型"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <List>
              {shown.length === 0 && <Empty>没有匹配的模型</Empty>}
              {shown.map((o) => (
                <label
                  key={o.id}
                  className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 hover:bg-hover"
                >
                  <input
                    type="checkbox"
                    className="ah-check"
                    disabled={disabled}
                    checked={chosen.has(lower(o.id))}
                    onChange={() => toggle(o.id)}
                  />
                  <ModelLabel id={o.id} name={o.name} />
                </label>
              ))}
            </List>
            {addField}
          </>
        ) : (
          <>
            {addField}
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-line-strong border-dashed px-6 text-center text-ink-muted text-sm leading-5">
              这个服务没有现成的模型列表。
              <br />
              可以一次粘贴多个 ID，用逗号或换行分开。
            </div>
          </>
        )}
      </Pane>

      <Pane>
        <div className="flex h-7 shrink-0 items-center gap-2 px-0.5">
          <h4 className="font-medium text-ink">已选模型</h4>
          <span className="rounded-sm bg-control-hover px-1.5 font-medium text-ink-2 text-xs leading-5">
            {selected.length}
          </span>
          <span className="flex-1" />
          {selected.length > 0 && (
            <Button variant="link" size="sm" disabled={disabled} onClick={() => onChange([])}>
              全部移除
            </Button>
          )}
        </div>
        <List>
          {selected.length === 0 && <Empty>还没有选模型</Empty>}
          {selected.map((id) => (
            <div
              key={id}
              className="flex min-h-9 shrink-0 items-center gap-2 rounded-md py-1 pr-1 pl-2.5 hover:bg-hover"
            >
              <ModelLabel id={id} name={names.get(lower(id)) ?? id} />
              <button
                type="button"
                aria-label={`移除 ${id}`}
                title="移除"
                disabled={disabled}
                onClick={() => toggle(id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-dim hover:bg-control-hover hover:text-ink"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </List>
      </Pane>
    </div>
  );
}

function Pane({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2.5 rounded-card border border-line bg-inset p-3">
      {children}
    </section>
  );
}

/** The pane's own scrolling list; it takes whatever height the pane has left. */
function List({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5">{children}</div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-ink-muted text-sm">
      {children}
    </div>
  );
}

function ModelLabel({ id, name }: { id: string; name: string }) {
  return (
    <span className="selectable flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 shrink-0 max-w-full truncate font-mono text-ink text-md">{id}</span>
      {name !== id && (
        <span className="min-w-0 flex-1 truncate text-ink-muted text-sm">{name}</span>
      )}
    </span>
  );
}
