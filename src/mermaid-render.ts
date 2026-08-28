import type { default as MermaidAPI } from "mermaid";

// Mermaid is a large dependency most notes never touch — loaded on demand
// (only when a note actually has a ```mermaid block to render) instead of
// as part of the eager app bundle every user pays for on first load.
let mermaidModule: typeof MermaidAPI | null = null;
let currentlyDark = true;

async function getMermaid(): Promise<typeof MermaidAPI> {
  if (!mermaidModule) {
    const { default: mermaid } = await import("mermaid");
    // securityLevel: "strict" keeps mermaid from executing click-handler
    // script embedded in diagram source and sanitizes labels — required
    // given a shared note's diagram source can come from another
    // (possibly untrusted) editor.
    mermaid.initialize({ startOnLoad: false, theme: currentlyDark ? "dark" : "default", securityLevel: "strict" });
    mermaidModule = mermaid;
  }
  return mermaidModule;
}

// Switches mermaid's own light/dark palette to match the app theme. Only
// affects diagrams rendered *after* the switch — already-rendered SVGs
// don't retroactively repaint, which is fine since a theme change re-runs
// the whole preview render anyway (new html -> data-rendered is unset). If
// mermaid hasn't been loaded yet, this just updates the value it'll
// initialize with on first use.
export function setMermaidDark(dark: boolean): void {
  if (dark === currentlyDark) return;
  currentlyDark = dark;
  if (mermaidModule) {
    mermaidModule.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
  }
}

let counter = 0;

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(".mermaid-block:not([data-rendered])")
  );
  if (blocks.length === 0) return;

  const mermaid = await getMermaid();
  for (const block of blocks) {
    const source = block.dataset.mermaidSource ?? "";
    const id = `mermaid-${Date.now()}-${counter++}`;
    try {
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
    } catch (err) {
      block.innerHTML = `<div class="mermaid-error">Mermaid error: ${err instanceof Error ? err.message : String(err)}</div>`;
    }
    block.setAttribute("data-rendered", "true");
  }
}
