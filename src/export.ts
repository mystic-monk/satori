import katexCss from "katex/dist/katex.min.css?raw";
import hljsCss from "highlight.js/styles/github.css?raw";
import { IS_TAURI } from "./platform";
import { printCurrentWindow, saveExportFile } from "./api";

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "note";
}

// Browser-only — a Tauri WKWebView has no download manager to catch an
// <a download> click, so this path is only ever used in the web
// deployment (see IS_TAURI branches below, which use a real native Save
// dialog instead).
function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportMarkdown(path: string, raw: string): Promise<void> {
  const filename = path.split("/").pop() || "note.md";
  if (IS_TAURI) {
    await saveExportFile(filename, raw, "Markdown", "md");
    return;
  }
  downloadFile(filename, raw, "text/markdown");
}

// Scoped to .export-doc, not bare element selectors — this same CSS string
// gets injected two different ways: as a real <body> in its own standalone
// document (wrapHtmlDocument, browser-mode PDF/HTML export) where an
// unscoped `body { }` rule would be fine, but also as a <style> tag inside
// a div sitting in the *live app's own DOM* (printExportContainer, Tauri's
// PDF export) — and a <style> element's rules apply document-wide the
// moment they exist, regardless of whether their container is
// display:none. An earlier, unscoped version of this file leaked its
// white-background/narrow-column export styling onto the entire running
// app the moment someone clicked PDF in the native app, because that
// container is left in the DOM permanently rather than removed after use.
// Both call sites now add the .export-doc class to whatever element is
// standing in for this content's root, so the same string is genuinely
// safe in either context.
const EXPORT_CSS = `
  .export-doc { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #fff;
         max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
  .export-doc h1, .export-doc h2, .export-doc h3 { line-height: 1.25; }
  .export-doc pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
  .export-doc code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .export-doc table { border-collapse: collapse; }
  .export-doc th, .export-doc td { border: 1px solid #ddd; padding: 6px 10px; }
  .export-doc blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 12px; color: #555; }
  .export-doc .callout { border: 1px solid #ddd; border-left-width: 4px; border-radius: 6px; padding: 10px 14px; margin: 12px 0; background: #f6f8fa; }
  .export-doc .callout-title { font-weight: 600; margin-bottom: 4px; }
  .export-doc .transclusion { border: 1px dashed #ccc; border-radius: 6px; padding: 10px 14px; margin: 12px 0; }
  .export-doc .transclusion-title { font-weight: 600; font-size: 0.85em; color: #666; margin-bottom: 6px; }
  .export-doc .wikilink { color: #2563eb; text-decoration: none; }
  .export-doc .wikilink-broken { color: #b91c1c; }
  @media print { .export-doc { margin: 0; max-width: none; } }
`;

function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${katexCss}</style>
<style>${hljsCss}</style>
<style>${EXPORT_CSS}</style>
</head>
<body class="export-doc">
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export async function exportHtml(title: string, bodyHtml: string): Promise<void> {
  const filename = `${slugify(title)}.html`;
  const content = wrapHtmlDocument(title, bodyHtml);
  if (IS_TAURI) {
    await saveExportFile(filename, content, "HTML", "html");
    return;
  }
  downloadFile(filename, content, "text/html");
}

// Persistent, normally-invisible container (see .pkm-printing in
// index.css) rather than create-then-remove per export: WebviewWindow's
// native print dialog (Tauri) reads the DOM live, so removing the content
// immediately after calling print() risks a race against however long the
// OS dialog takes to actually capture it. Left in place and just
// overwritten on each export instead.
function printExportContainer(title: string, bodyHtml: string): HTMLElement {
  let container = document.getElementById("pkm-print-export");
  if (!container) {
    container = document.createElement("div");
    container.id = "pkm-print-export";
    container.className = "export-doc";
    document.body.appendChild(container);
  }
  container.innerHTML = `<style>${katexCss}</style><style>${hljsCss}</style><style>${EXPORT_CSS}</style><h1>${escapeHtml(title)}</h1>${bodyHtml}`;
  return container;
}

// PDF export goes through the browser's native print-to-PDF in the web
// deployment (window.open() + print() — works fine in a real browser tab)
// or the native app's real OS print dialog in Tauri (which already has
// "Save as PDF" built in on macOS) — window.open() isn't reliable inside
// a Tauri webview the way it is in a browser, so these two paths are kept
// deliberately separate rather than trying to unify them.
export async function exportPdf(title: string, bodyHtml: string): Promise<void> {
  if (IS_TAURI) {
    printExportContainer(title, bodyHtml);
    document.body.classList.add("pkm-printing");
    try {
      await printCurrentWindow();
    } finally {
      document.body.classList.remove("pkm-printing");
    }
    return;
  }
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.open();
  win.document.write(wrapHtmlDocument(title, bodyHtml));
  win.document.close();
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  });
}
