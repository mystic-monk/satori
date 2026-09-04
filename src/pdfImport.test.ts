import { describe, expect, it, vi } from "vitest";

// Only the page-count cap is meaningfully unit-testable here — it short-
// circuits before any canvas/DOM work, which this project's plain-Node
// vitest environment (no jsdom) can't do anyway. Actual page rendering is
// covered live (Playwright), not here.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 41, getPage: vi.fn() }) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));

const { processPdf, PdfTooLargeError, MAX_PAGES } = await import("./pdfImport");

describe("processPdf", () => {
  it("rejects a PDF past the page cap before touching any page/canvas work", async () => {
    const file = new File([new Uint8Array()], "big.pdf", { type: "application/pdf" });
    await expect(processPdf(file)).rejects.toThrow(PdfTooLargeError);
  });

  it("cap is 40 pages", () => {
    expect(MAX_PAGES).toBe(40);
  });
});
