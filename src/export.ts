import katexCss from "katex/dist/katex.min.css?raw";
import hljsCss from "highlight.js/styles/github.css?raw";

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "note";
}

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

export function exportMarkdown(path: string, raw: string): void {
  downloadFile(path.split("/").pop() || "note.md", raw, "text/markdown");
}

const EXPORT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #fff;
         max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
  h1, h2, h3 { line-height: 1.25; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; }
  blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 12px; color: #555; }
  .callout { border: 1px solid #ddd; border-left-width: 4px; border-radius: 6px; padding: 10px 14px; margin: 12px 0; background: #f6f8fa; }
  .callout-title { font-weight: 600; margin-bottom: 4px; }
  .transclusion { border: 1px dashed #ccc; border-radius: 6px; padding: 10px 14px; margin: 12px 0; }
  .transclusion-title { font-weight: 600; font-size: 0.85em; color: #666; margin-bottom: 6px; }
  .wikilink { color: #2563eb; text-decoration: none; }
  .wikilink-broken { color: #b91c1c; }
  @media print { body { margin: 0; max-width: none; } }
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
<body>
<h1>${escapeHtml(title)}</h1>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export function exportHtml(title: string, bodyHtml: string): void {
  downloadFile(`${slugify(title)}.html`, wrapHtmlDocument(title, bodyHtml), "text/html");
}

// PDF export goes through the browser's native print-to-PDF rather than a
// bundled PDF-generation library — keeps the dependency footprint small and
// gets correct pagination/fonts for free.
export function exportPdf(title: string, bodyHtml: string): void {
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
