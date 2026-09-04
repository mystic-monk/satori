import * as pdfjsLib from "pdfjs-dist";
// Vite's `?url` suffix resolves this to a served asset URL rather than
// executing it — pdf.js needs its worker script loaded as a real Worker,
// not bundled inline.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Renders at a fixed, modest scale — enough to read and annotate
// comfortably, not print quality. Deliberate size mitigation: every
// rendered page ends up as inline base64 in the note's Yjs text (see
// PdfNote.tsx, which reuses CanvasNote.tsx's embedded-image mechanism
// wholesale), and that has no size guard of its own.
const RENDER_SCALE = 1.5;
// Same mitigation, the other axis — bounds the worst case rather than
// letting an arbitrarily long document produce an arbitrarily large note.
export const MAX_PAGES = 40;

export interface PdfPage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ProcessedPdf {
  pages: PdfPage[];
  text: string;
}

export class PdfTooLargeError extends Error {
  constructor(public pageCount: number) {
    super(`PDF has ${pageCount} pages — the ${MAX_PAGES}-page limit keeps annotation notes from becoming enormous.`);
  }
}

export async function processPdf(file: File): Promise<ProcessedPdf> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  if (doc.numPages > MAX_PAGES) {
    throw new PdfTooLargeError(doc.numPages);
  }

  const pages: PdfPage[] = [];
  const textParts: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);

    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    // @ts-expect-error -- pdf.js's RenderParameters type wants `canvas` in
    // newer versions but `canvasContext` still works and is what every
    // current example/doc uses; not worth fighting the type for this.
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      dataUrl: canvas.toDataURL("image/jpeg", 0.8),
      width: viewport.width,
      height: viewport.height,
    });

    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    textParts.push(pageText);
  }

  return { pages, text: textParts.join("\n\n") };
}
