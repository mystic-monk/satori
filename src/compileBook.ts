import type { NoteListItem } from "./api";
import { parseFrontmatter } from "../shared/frontmatter";
import { queryNotes } from "./noteQuery";
import { countWords } from "./wordCount";

export interface CompiledBook {
  raw: string;
  chapterCount: number;
  wordCount: number;
}

// Chapters relate to a book the same way the Book template's own
// ```query block finds them (see starter-vault/templates/book.md) —
// type: chapter, book: [[Book Title]] as a literal frontmatter string,
// matched by noteQuery's exact-equality filter. `order` sorts them;
// missing/non-numeric order falls back to 0 rather than throwing, so a
// chapter someone forgot to number still ends up in the compiled doc.
export async function compileBook(
  book: NoteListItem,
  notes: NoteListItem[],
  fetchChapterRaw: (path: string) => Promise<string>
): Promise<CompiledBook> {
  const chapters = queryNotes(notes, { type: "chapter", book: `[[${book.title}]]` }).sort(
    (a, b) => Number(a.properties.order ?? 0) - Number(b.properties.order ?? 0)
  );

  let wordCount = 0;
  const sections = await Promise.all(
    chapters.map(async (chapter) => {
      const raw = await fetchChapterRaw(chapter.path);
      const body = parseFrontmatter(raw).body.trim();
      wordCount += countWords(body);
      return `## ${chapter.title}\n\n${body}`;
    })
  );

  return {
    raw: `# ${book.title}\n\n${sections.join("\n\n")}\n`,
    chapterCount: chapters.length,
    wordCount,
  };
}
