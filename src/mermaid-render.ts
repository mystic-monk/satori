import mermaid from "mermaid";

// securityLevel: "strict" keeps mermaid from executing click-handler script
// embedded in diagram source and sanitizes labels — required given a shared
// note's diagram source can come from another (possibly untrusted) editor.
mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

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
