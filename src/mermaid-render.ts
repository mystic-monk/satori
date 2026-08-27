import mermaid from "mermaid";

// securityLevel: "strict" keeps mermaid from executing click-handler script
// embedded in diagram source and sanitizes labels — required given a shared
// note's diagram source can come from another (possibly untrusted) editor.
let currentlyDark = true;
mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

// Switches mermaid's own light/dark palette to match the app theme. Only
// affects diagrams rendered *after* the switch — already-rendered SVGs
// don't retroactively repaint, which is fine since a theme change re-runs
// the whole preview render anyway (new html -> data-rendered is unset).
export function setMermaidDark(dark: boolean): void {
  if (dark === currentlyDark) return;
  currentlyDark = dark;
  mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
}

let counter = 0;

export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(".mermaid-block:not([data-rendered])")
  );
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
