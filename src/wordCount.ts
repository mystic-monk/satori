// Plain whitespace-token counting, same convention as most markdown
// editors (Scrivener, iA Writer) — markdown syntax (`**bold**`, `[[link]]`)
// counts as part of a word rather than being stripped out first, which
// keeps this a single cheap pass with no markdown parsing involved.
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
