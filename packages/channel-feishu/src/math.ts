// LaTeX math in agents' replies, made readable in Feishu cards. Feishu card markdown does not
// render TeX, so `$O(n \log \log n)$` reached the owner as is. Math spans are rewritten into
// plain Unicode text (`O(n log log n)`, `x²`, `a ≤ b`, `α/β`); code blocks and inline code are
// left alone. A span is math only when it looks like TeX, so prices like "$5 and $10" stay.

const SYMBOLS: Record<string, string> = {
  // Greek
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  // Operators and relations
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  ast: "∗",
  star: "⋆",
  circ: "∘",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  simeq: "≃",
  cong: "≅",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  oplus: "⊕",
  otimes: "⊗",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  implies: "⇒",
  iff: "⇔",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  uparrow: "↑",
  downarrow: "↓",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "Σ",
  prod: "Π",
  int: "∫",
  oint: "∮",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  mid: "|",
  vert: "|",
  Vert: "‖",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  langle: "⟨",
  rangle: "⟩",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  top: "⊤",
  bot: "⊥",
  prime: "′",
  hbar: "ℏ",
  ell: "ℓ",
  Re: "ℜ",
  Im: "ℑ",
  aleph: "ℵ",
  deg: "°",
  // Spacing
  quad: " ",
  qquad: "  ",
};

/** Function names written upright: `\log n` is "log n". */
const FUNCTIONS = new Set([
  "log",
  "ln",
  "lg",
  "exp",
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "max",
  "min",
  "sup",
  "inf",
  "lim",
  "limsup",
  "liminf",
  "arg",
  "det",
  "dim",
  "gcd",
  "ker",
  "deg",
  "Pr",
  "mod",
  "bmod",
]);

/** Commands whose one argument is kept as text: `\text{if}` is "if". */
const KEEP_ARG = new Set([
  "text",
  "textrm",
  "textbf",
  "textit",
  "texttt",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "mathcal",
  "mathbb",
  "mathfrak",
  "boldsymbol",
  "operatorname",
  "bm",
  "mbox",
  "hat",
  "bar",
  "overline",
  "underline",
  "tilde",
  "vec",
  "dot",
  "ddot",
  "widehat",
  "widetilde",
]);

const SUPER: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  k: "ᵏ",
  m: "ᵐ",
  x: "ˣ",
  T: "ᵀ",
  "∗": "*",
  "*": "*",
  "′": "′",
};

const SUB: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  x: "ₓ",
};

/** The `{...}` group starting at `i` (or the single next token), and where it ends. */
function group(tex: string, i: number): { body: string; end: number } {
  let j = i;
  while (tex[j] === " ") j++;
  if (tex[j] === "{") {
    let depth = 0;
    for (let k = j; k < tex.length; k++) {
      if (tex[k] === "{") depth++;
      else if (tex[k] === "}") {
        depth--;
        if (depth === 0) return { body: tex.slice(j + 1, k), end: k + 1 };
      }
    }
    return { body: tex.slice(j + 1), end: tex.length };
  }
  if (tex[j] === "\\") {
    const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(j));
    if (m !== null) return { body: m[0], end: j + m[0].length };
  }
  return { body: tex[j] ?? "", end: Math.min(j + 1, tex.length) };
}

/** Wrap a multi-character piece in parentheses: `a+b` → `(a+b)`, `x` stays. */
function atom(text: string): string {
  return /^[\p{L}\p{N}.′]+$/u.test(text) || /^\(.*\)$/.test(text) ? text : `(${text})`;
}

function script(text: string, map: Record<string, string>, mark: string): string {
  const chars = [...text];
  if (chars.length > 0 && chars.every((c) => map[c] !== undefined)) {
    return chars.map((c) => map[c]).join("");
  }
  return `${mark}${chars.length === 1 || /^\(.*\)$/.test(text) ? text : `(${text})`}`;
}

/** TeX math source as plain Unicode text. */
export function texToText(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const c = tex[i] as string;
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(tex.slice(i));
      if (m === null) {
        i++;
        continue;
      }
      const name = m[1] as string;
      i += m[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const a = group(tex, i);
        const b = group(tex, a.end);
        i = b.end;
        out += `${atom(texToText(a.body))}/${atom(texToText(b.body))}`;
      } else if (name === "sqrt") {
        let degree = "";
        if (tex[i] === "[") {
          const close = tex.indexOf("]", i);
          if (close > i) {
            degree = texToText(tex.slice(i + 1, close));
            i = close + 1;
          }
        }
        const a = group(tex, i);
        i = a.end;
        const root = degree === "3" ? "∛" : degree === "4" ? "∜" : `${degree}√`;
        out += `${degree === "" ? "√" : root}${atom(texToText(a.body))}`;
      } else if (name === "binom") {
        const a = group(tex, i);
        const b = group(tex, a.end);
        i = b.end;
        out += `C(${texToText(a.body)}, ${texToText(b.body)})`;
      } else if (KEEP_ARG.has(name)) {
        const a = group(tex, i);
        i = a.end;
        out += texToText(a.body);
      } else if (name === "left" || name === "right" || name === "big" || name === "Big") {
        // Sizing only; the delimiter that follows is kept.
      } else if (FUNCTIONS.has(name)) {
        out += name === "bmod" ? " mod " : name;
        if (/^[A-Za-z0-9\\]/.test(tex[i] ?? "") || tex[i] === " ") out += " ";
        while (tex[i] === " ") i++;
      } else if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
      } else if (name === "," || name === ";" || name === ":" || name === " ") {
        out += " ";
      } else if (name === "!") {
        // Negative space.
      } else if (name.length === 1) {
        out += name; // \{ \} \% \$ \_ \& \#
      } else {
        out += name;
      }
    } else if (c === "^" || c === "_") {
      const a = group(tex, i + 1);
      i = a.end;
      const body = texToText(a.body);
      out += c === "^" ? script(body, SUPER, "^") : script(body, SUB, "_");
    } else if (c === "{" || c === "}") {
      i++;
    } else if (c === "~") {
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/** Plain math text that is safe in Feishu markdown; inline code when it is not. */
function shown(tex: string): string {
  const text = texToText(tex);
  return /[*_~`<>[\]]/.test(text) ? `\`${text.replaceAll("`", "'")}\`` : text;
}

/** Whether `$...$` content looks like TeX rather than money or a shell variable. */
function looksLikeTex(body: string): boolean {
  if (/^\s|\s$/.test(body)) return false;
  return /[\\^_{}]/.test(body) || /^[A-Za-z]$/.test(body) || /^[A-Za-z0-9]+\s*[=<>+-]/.test(body);
}

/** Rewrite the math spans of a markdown text outside code. */
function rewriteProse(text: string): string {
  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => shown(tex))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => shown(tex))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => shown(tex))
    .replace(/(^|[^\\$\w])\$([^$\n]+?)\$(?![\w$])/g, (all, lead: string, tex: string) =>
      looksLikeTex(tex) ? `${lead}${shown(tex)}` : all,
    );
}

/** A markdown text with its LaTeX math made readable; fenced and inline code untouched. */
export function readableMath(markdown: string): string {
  if (!markdown.includes("$") && !markdown.includes("\\(") && !markdown.includes("\\[")) {
    return markdown;
  }
  // Split off code: ``` fenced blocks, then `inline` spans.
  return markdown
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, n) =>
      n % 2 === 1
        ? part
        : part
            .split(/(`[^`\n]*`)/)
            .map((piece, k) => (k % 2 === 1 ? piece : rewriteProse(piece)))
            .join(""),
    )
    .join("");
}
