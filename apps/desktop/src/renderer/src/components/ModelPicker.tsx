// Picks the models a service turns on: a searchable checkbox list for built-in providers,
// a free text list of model ids for OpenAI-compatible endpoints.

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { parseModelList } from "./labels";
import { inputClass } from "./ui";

export function ModelChecklist({
  options,
  selected,
  onChange,
}: {
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (models: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  // Models already on the service but missing from the catalog stay selectable.
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.id));
    const extra = selected.filter((id) => !known.has(id)).map((id) => ({ id, name: id }));
    return [...extra, ...options];
  }, [options, selected]);
  const q = query.trim().toLowerCase();
  const shown =
    q === ""
      ? all
      : all.filter((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((m) => m !== id) : [...selected, id]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={14} className="absolute top-2.5 left-2.5 text-zinc-400" />
        <input
          className={`${inputClass} pl-8`}
          placeholder="搜索模型"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>已选 {selected.length} 个</span>
        {selected.length > 0 && (
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => onChange([])}
          >
            全部取消
          </button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
        {shown.length === 0 && (
          <div className="px-3 py-4 text-center text-sm text-zinc-500">没有匹配的模型</div>
        )}
        {shown.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2.5 border-zinc-100 border-b px-3 py-2 last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
          >
            <input
              type="checkbox"
              className="accent-blue-600"
              checked={selected.includes(o.id)}
              onChange={() => toggle(o.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">
                {o.name}
              </span>
              {o.name !== o.id && (
                <span className="block truncate font-mono text-xs text-zinc-500">{o.id}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ModelTextList({
  text,
  onChange,
}: {
  text: string;
  onChange: (text: string) => void;
}) {
  const count = parseModelList(text).length;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        className={`${inputClass} h-32 resize-none py-2 font-mono`}
        placeholder={"每行一个模型 ID，或用逗号分隔，例如：\nqwen3-coder-plus\ndeepseek-v3"}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-xs text-zinc-500">
        {count === 0 ? "填写服务商给的模型 ID" : `共 ${count} 个模型`}
      </span>
    </div>
  );
}
