import type KatexAPI from "katex";

// Same reasoning and shape as mermaid-render.ts: KaTeX is a large
// dependency (~260KB) most notes never touch, loaded on demand only once
// a note that actually has math gets rendered, instead of being part of
// the eager app bundle every user pays for on first load.
let katexModule: typeof KatexAPI | null = null;

async function getKatex(): Promise<typeof KatexAPI> {
  if (!katexModule) {
    const mod = await import("katex");
    katexModule = mod.default;
  }
  return katexModule;
}

export async function renderMathBlocks(container: HTMLElement): Promise<void> {
  const els = Array.from(container.querySelectorAll<HTMLElement>(".math-pending"));
  if (els.length === 0) return;

  const katex = await getKatex();
  for (const el of els) {
    const tex = el.dataset.tex ?? "";
    const displayMode = el.dataset.display === "true";
    try {
      el.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode, trust: false });
    } catch {
      el.textContent = tex; // already the placeholder's own content, but explicit on the error path too
      el.classList.add("math-error");
    }
    el.classList.remove("math-pending");
  }
}
