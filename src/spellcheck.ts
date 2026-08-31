import type NSpellType from "nspell";

// en_US Hunspell dictionary (SCOWL wordlist, see src/dictionaries/LICENSE),
// copied as static data rather than depending on the `dictionary-en` npm
// package at runtime — that package reads its .aff/.dic files via node:fs
// at import time, which only works in a Node process, not this app's
// Vite/Tauri-WebKit bundle. Loaded lazily (~550KB) the same way mermaid/
// KaTeX are (see mermaid-render.ts) — only once spell check is actually
// turned on, and cached after that.
let spellchecker: NSpellType | null = null;
let loading: Promise<NSpellType> | null = null;

async function getSpellchecker(): Promise<NSpellType> {
  if (spellchecker) return spellchecker;
  if (!loading) {
    loading = (async () => {
      const [{ default: nspell }, { default: aff }, { default: dic }] = await Promise.all([
        import("nspell"),
        import("./dictionaries/en.aff?raw"),
        import("./dictionaries/en.dic?raw"),
      ]);
      spellchecker = nspell(aff, dic);
      return spellchecker;
    })();
  }
  return loading;
}

export interface Misspelling {
  from: number;
  to: number;
  word: string;
}

// Letters plus internal apostrophes ("don't" is one word, not two) — a
// prose-scale approximation, not a full tokenizer; markdown syntax
// characters (*, [, #, etc.) never match so they're never flagged.
const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/g;

export async function checkText(text: string): Promise<Misspelling[]> {
  const spell = await getSpellchecker();
  const results: Misspelling[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    if (spell.correct(word)) continue;
    results.push({ from: match.index, to: match.index + word.length, word });
  }
  return results;
}

export async function suggest(word: string): Promise<string[]> {
  const spell = await getSpellchecker();
  return spell.suggest(word);
}

// Marks a word correct for the rest of this session, across every note —
// nspell's own add() (not a separate ignore-list on this app's side), so
// a character name flagged once in Chapter 1 stops being flagged in every
// later chapter too. Not persisted to disk; resets on reload.
export async function addWord(word: string): Promise<void> {
  const spell = await getSpellchecker();
  spell.add(word);
}
