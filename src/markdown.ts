import MarkdownIt from "markdown-it";
import { extractWikilinkRefs as extractWikilinkRefsFromBody, type WikilinkRef } from "../shared/wikilinks.js";
import { fragmentLabel, resolveFragment, stripBlockMarker } from "../shared/blockrefs.js";

type MDInstance = InstanceType<typeof MarkdownIt>;
// The full "highlight.js" package bundles ~190 languages (~1MB+) eagerly;
// registering a curated set against the core keeps the app bundle small.
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import katex from "katex";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);

export interface ResolvedNote {
  path: string;
  title: string;
}

export interface NoteResolver {
  resolve(ref: string): ResolvedNote | null;
}

// A citation resolves to a reference note the same way a wikilink does
// (path + title), but also needs author/year to render as "(Author,
// Year)" rather than a bare title link — that extra shape is why this
// is a separate map on RenderEnv rather than reusing `resolver`.
export interface CitationInfo {
  path: string;
  title: string;
  author?: string;
  year?: string;
}

export interface RenderEnv {
  resolver: NoteResolver;
  bodies: Map<string, string>; // path -> raw body (frontmatter stripped), for transclusion
  pathStack: Set<string>; // cycle guard for nested transclusion
  citations?: Map<string, CitationInfo>; // citekey -> reference note, for [@citekey] and ```bibliography
  [key: string]: unknown; // markdown-it's Env type is an open string-keyed bag
  [key: symbol]: unknown;
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode, trust: false });
  } catch {
    return `<span class="math-error">${new MarkdownIt().utils.escapeHtml(tex)}</span>`;
  }
}

function mathPlugin(md: MDInstance) {
  // Block math: a line that is exactly $$...$$ (single line) or a $$ ... $$
  // fence spanning multiple lines.
  md.block.ruler.before(
    "fence",
    "math_block",
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(start, max);
      if (!line.trim().startsWith("$$")) return false;

      const firstLineRest = line.trim().slice(2);
      if (firstLineRest.trim().endsWith("$$") && firstLineRest.trim().length >= 2) {
        // single-line $$...$$
        if (silent) return true;
        const tex = firstLineRest.trim().slice(0, -2);
        const token = state.push("math_block", "", 0);
        token.content = tex;
        token.map = [startLine, startLine + 1];
        state.line = startLine + 1;
        return true;
      }

      let nextLine = startLine + 1;
      let found = false;
      const bodyLines: string[] = [firstLineRest];
      while (nextLine < endLine) {
        const s = state.bMarks[nextLine] + state.tShift[nextLine];
        const e = state.eMarks[nextLine];
        const text = state.src.slice(s, e);
        if (text.trim() === "$$") {
          found = true;
          break;
        }
        bodyLines.push(text);
        nextLine++;
      }
      if (!found) return false;
      if (silent) return true;

      const token = state.push("math_block", "", 0);
      token.content = bodyLines.join("\n").trim();
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    },
    { alt: [] }
  );
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>\n`;

  // Inline math: $...$ (no surrounding whitespace right after/before $, avoids
  // colliding with currency amounts like "$5 and $10").
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== "$" || src[pos + 1] === "$") return false;
    if (/\s/.test(src[pos + 1] ?? "")) return false;
    const end = src.indexOf("$", pos + 1);
    if (end === -1) return false;
    if (/\s/.test(src[end - 1] ?? "")) return false;

    if (!silent) {
      const token = state.push("math_inline", "", 0);
      token.content = src.slice(pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
}

// `> [!type] Title` followed by more `>`-prefixed lines becomes a callout
// div. This is a block rule (not a post-process of parsed blockquote
// tokens) specifically so multi-line callout bodies work: markdown-it joins
// consecutive `>` lines into one paragraph, and a title regex anchored with
// `$` can't span that embedded newline. Body content is parsed with
// block.parse() (a fresh, self-contained parse — no shared-offset bookkeeping
// needed) and its tokens spliced into the main stream, so lists, code
// blocks, nested callouts etc. all work inside a callout, not just text.
function calloutsPlugin(md: MDInstance) {
  md.block.ruler.before(
    "blockquote",
    "callout",
    (state, startLine, endLine, silent) => {
      const startPos = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const firstLine = state.src.slice(startPos, max);
      const match = /^>\s?\[!(\w+)\][+-]?\s*(.*)$/.exec(firstLine);
      if (!match) return false;
      if (silent) return true;

      const calloutType = match[1].toLowerCase();
      const title = match[2].trim() || match[1];

      let nextLine = startLine + 1;
      const innerLines: string[] = [];
      while (nextLine < endLine) {
        const pos = state.bMarks[nextLine] + state.tShift[nextLine];
        const text = state.src.slice(pos, state.eMarks[nextLine]);
        if (!/^>\s?/.test(text)) break;
        innerLines.push(text.replace(/^>\s?/, ""));
        nextLine++;
      }

      const openToken = state.push("callout_open", "div", 1);
      openToken.attrSet("class", `callout callout-${calloutType}`);
      openToken.attrSet("data-callout", calloutType);
      openToken.map = [startLine, nextLine];
      openToken.block = true;

      state.push("callout_title_open", "div", 1).attrSet("class", "callout-title");
      const titleToken = state.push("inline", "", 0);
      titleToken.content = title;
      titleToken.children = [];
      state.push("callout_title_close", "div", -1);

      state.push("callout_body_open", "div", 1).attrSet("class", "callout-content");
      const bodyTokens: InstanceType<typeof MarkdownIt.Token>[] = [];
      state.md.block.parse(innerLines.join("\n"), state.md, state.env, bodyTokens);
      state.tokens.push(...bodyTokens);
      state.push("callout_body_close", "div", -1);

      state.push("callout_close", "div", -1);

      state.line = nextLine;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] }
  );
}

// ==highlighted text== and %%inline comment%% — the two inline formatting
// primitives markdown-it doesn't provide out of the box (bold/italic/
// strikethrough/code all come standard). Simple non-nested delimiter
// matching, same approach as the math_inline rule above.
function highlightsAndCommentsPlugin(md: MDInstance) {
  function delimitedRule(name: string, marker: string, render: (inner: string) => string) {
    md.inline.ruler.after("emphasis", name, (state, silent) => {
      const src = state.src;
      const pos = state.pos;
      if (!src.startsWith(marker, pos)) return false;
      const end = src.indexOf(marker, pos + marker.length);
      if (end === -1 || end === pos + marker.length) return false;
      if (!silent) {
        const token = state.push(name, "", 0);
        token.content = src.slice(pos + marker.length, end);
      }
      state.pos = end + marker.length;
      return true;
    });
    md.renderer.rules[name] = (tokens, idx) => render(tokens[idx].content);
  }

  delimitedRule("highlight_inline", "==", (inner) => `<mark>${md.utils.escapeHtml(inner)}</mark>`);
  delimitedRule(
    "comment_inline",
    "%%",
    (inner) => `<span class="inline-comment" title="comment">💬 ${md.utils.escapeHtml(inner)}</span>`
  );
}

// `- [ ] text` / `- [x] text` list items become an interactive checkbox.
// Runs as a core rule after inline parsing (not a custom inline/block rule)
// because it needs to inspect an already-parsed list item's first inline
// token and mutate it in place — markdown-it's own list parsing already
// did the hard work, this just recognizes the leading "[ ] "/"[x] " text
// and swaps it for a checkbox token. `data-line` carries the item's start
// line *within the frontmatter-stripped body* (matching stripFrontmatter
// above) so Preview.tsx can write the toggle straight back to that line —
// see toggleTaskLine there for the other half of this.
function taskListsPlugin(md: MDInstance) {
  md.core.ruler.after("inline", "task_lists", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== "inline" || !inline.children || inline.children.length === 0) continue;
      const first = inline.children[0];
      if (first.type !== "text") continue;
      const match = /^\[([ xX])\]\s+/.exec(first.content);
      if (!match) continue;
      const liToken = tokens[i - 2];
      if (!liToken || liToken.type !== "list_item_open") continue;
      const checked = match[1].toLowerCase() === "x";
      first.content = first.content.slice(match[0].length);
      liToken.attrJoin("class", "task-list-item");
      const line = liToken.map ? liToken.map[0] : -1;
      const checkbox = new state.Token("task_checkbox", "", 0);
      checkbox.meta = { checked, line };
      inline.children.unshift(checkbox);
    }
  });
  md.renderer.rules.task_checkbox = (tokens, idx) => {
    const { checked, line } = tokens[idx].meta as { checked: boolean; line: number };
    return `<input type="checkbox" class="task-checkbox" data-line="${line}" ${checked ? "checked" : ""} />`;
  };
}

function stripFrontmatter(raw: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  return m ? raw.slice(m[0].length) : raw;
}

// [[ref]] / [[ref|alias]] links, and ![[ref]] whole-note transclusion.
// [[ref]], [[ref#Heading]], [[ref#^block-id]] links (± |alias), and
// ![[...]] embeds of the same three forms — a bare embed inlines the
// whole target note (existing behavior), a #Heading/#^block-id embed
// inlines just that section/block, resolved via shared/blockrefs.ts.
function wikilinksPlugin(md: MDInstance) {
  md.inline.ruler.before("link", "wikilink", (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    const isEmbed = src[pos] === "!" && src[pos + 1] === "[" && src[pos + 2] === "[";
    const isLink = !isEmbed && src[pos] === "[" && src[pos + 1] === "[";
    if (!isEmbed && !isLink) return false;

    const start = isEmbed ? pos + 3 : pos + 2;
    const end = src.indexOf("]]", start);
    if (end === -1) return false;

    if (!silent) {
      const raw = src.slice(start, end);
      const [refAndFragment, aliasPart] = raw.split("|");
      const hashIdx = refAndFragment.indexOf("#");
      const ref = (hashIdx === -1 ? refAndFragment : refAndFragment.slice(0, hashIdx)).trim();
      const fragment = hashIdx === -1 ? undefined : refAndFragment.slice(hashIdx + 1).trim() || undefined;
      const token = state.push(isEmbed ? "wikiembed" : "wikilink", "", 0);
      token.meta = { ref, fragment, alias: aliasPart?.trim() };
    }
    state.pos = end + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx, _opts, envIn) => {
    const env = envIn as unknown as RenderEnv;
    const { ref, fragment, alias } = tokens[idx].meta as { ref: string; fragment?: string; alias?: string };
    const resolved = env.resolver.resolve(ref);
    // Whether `fragment` actually exists in the target note isn't checked
    // here — that needs the target's body, which a plain link (unlike an
    // embed) never fetches. Same tradeoff a normal [[Note]] link already
    // has: it doesn't confirm the note is non-empty, either.
    const defaultLabel = fragment ? `${resolved?.title ?? ref} › ${fragmentLabel(fragment)}` : resolved?.title || ref;
    const label = md.utils.escapeHtml(alias || defaultLabel);
    if (!resolved) {
      return `<a class="wikilink wikilink-broken" data-missing-ref="${md.utils.escapeHtml(ref)}">${label}</a>`;
    }
    return `<a class="wikilink" data-note-path="${md.utils.escapeHtml(resolved.path)}" href="javascript:void(0)">${label}</a>`;
  };

  md.renderer.rules.wikiembed = (tokens, idx, _opts, envIn) => {
    const env = envIn as unknown as RenderEnv;
    const { ref, fragment } = tokens[idx].meta as { ref: string; fragment?: string };
    const resolved = env.resolver.resolve(ref);
    if (!resolved) {
      return `<div class="transclusion transclusion-missing">Missing note: ${md.utils.escapeHtml(ref)}</div>`;
    }
    if (env.pathStack.has(resolved.path)) {
      return `<div class="transclusion transclusion-circular">Circular embed: ${md.utils.escapeHtml(resolved.title)}</div>`;
    }
    const body = env.bodies.get(resolved.path);
    if (body === undefined) {
      return `<div class="transclusion transclusion-loading" data-transclude-path="${md.utils.escapeHtml(
        resolved.path
      )}">Loading "${md.utils.escapeHtml(resolved.title)}"…</div>`;
    }
    const strippedBody = stripFrontmatter(body);
    let toRender = strippedBody;
    let titleSuffix = "";
    if (fragment) {
      const range = resolveFragment(strippedBody, fragment);
      if (!range) {
        return `<div class="transclusion transclusion-missing">No "${md.utils.escapeHtml(
          fragmentLabel(fragment)
        )}" ${fragment.startsWith("^") ? "block" : "heading"} in "${md.utils.escapeHtml(resolved.title)}"</div>`;
      }
      toRender = stripBlockMarker(strippedBody.slice(range.start, range.end));
      titleSuffix = ` › ${md.utils.escapeHtml(fragmentLabel(fragment))}`;
    }
    const nextEnv: RenderEnv = { ...env, pathStack: new Set(env.pathStack).add(resolved.path) };
    const inner = md.render(toRender, nextEnv);
    return `<div class="transclusion" data-transclude-path="${md.utils.escapeHtml(resolved.path)}">
      <div class="transclusion-title">${md.utils.escapeHtml(resolved.title)}${titleSuffix}</div>
      <div class="transclusion-body">${inner}</div>
    </div>`;
  };
}

// A trailing ^block-id on its own line (or at the end of a paragraph's
// last line) marks that line as addressable — dimmed in preview rather
// than hidden entirely, so it's visible which lines have a stable id
// without being distracting. Deliberate scope cut alongside
// resolveBlockFragment above: only matches when it's the very last thing
// in its containing block, same "a block is one line" boundary.
function blockIdMarkerPlugin(md: MDInstance) {
  md.inline.ruler.after("escape", "block_id_marker", (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== "^") return false;
    const m = /^\^([\w-]+)\s*$/.exec(src.slice(pos));
    if (!m) return false;
    if (!silent) {
      const token = state.push("block_id_marker", "", 0);
      token.content = m[1];
    }
    state.pos = src.length;
    return true;
  });
  md.renderer.rules.block_id_marker = (tokens, idx) =>
    `<span class="block-id-marker">^${md.utils.escapeHtml(tokens[idx].content)}</span>`;
}

// "(Author, Year)" from a CitationInfo — falls back to the reference
// note's title when author/year are missing, since a reference note
// created by hand (not via .bib import) might not have them filled in.
function formatCitationLabel(info: CitationInfo): string {
  if (!info.author && !info.year) return info.title;
  const lastName = info.author ? info.author.split(/,| and /)[0].trim() : "";
  const authorPart = lastName || info.title;
  return info.year ? `${authorPart}, ${info.year}` : authorPart;
}

// [@citekey] — the standard Pandoc/academic-markdown citation syntax.
// Deliberate scope cut: no locator suffix (`[@key, p. 12]`) and no
// multi-citation grouping (`[@key1; @key2]`) — a first pass covers the
// common "cite one source" case. Resolution is against env.citations
// (built in Preview.tsx from notes with type: reference), not the
// wikilink resolver — see CitationInfo's doc comment for why.
function citationsPlugin(md: MDInstance) {
  md.inline.ruler.before("link", "citation", (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    if (src[pos] !== "[" || src[pos + 1] !== "@") return false;
    const end = src.indexOf("]", pos + 2);
    if (end === -1) return false;
    const key = src.slice(pos + 2, end).trim();
    if (!key || /\s/.test(key)) return false;
    if (!silent) {
      const token = state.push("citation", "", 0);
      token.meta = { key };
    }
    state.pos = end + 1;
    return true;
  });

  md.renderer.rules.citation = (tokens, idx, _opts, envIn) => {
    const env = envIn as unknown as RenderEnv;
    const { key } = tokens[idx].meta as { key: string };
    const info = env.citations?.get(key);
    if (!info) {
      return `<span class="citation citation-broken" title="No reference note with citekey: ${md.utils.escapeHtml(
        key
      )}">[@${md.utils.escapeHtml(key)}]</span>`;
    }
    return `<a class="citation" data-note-path="${md.utils.escapeHtml(info.path)}" href="javascript:void(0)">(${md.utils.escapeHtml(
      formatCitationLabel(info)
    )})</a>`;
  };
}

export const md = new MarkdownIt({
  html: false, // never trust raw HTML from note content — see security note in README
  linkify: true,
  breaks: false,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch {
        // fall through to escaped default
      }
    }
    return "";
  },
});

md.use(mathPlugin);
md.use(calloutsPlugin);
md.use(wikilinksPlugin);
md.use(blockIdMarkerPlugin);
md.use(citationsPlugin);
md.use(highlightsAndCommentsPlugin);
md.use(taskListsPlugin);

// ```mermaid fenced blocks render as diagrams. Mermaid needs an async,
// DOM-attached render pass (mermaid.render() returns a Promise), which
// markdown-it's synchronous renderer can't do — so this just emits a
// placeholder carrying the raw source; Preview.tsx's effect finds
// .mermaid-block elements after insertion and fills them in.
const defaultFenceRule = md.renderer.rules.fence!.bind(md.renderer.rules);
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0];
  if (lang === "mermaid") {
    const source = md.utils.escapeHtml(token.content);
    return `<div class="mermaid-block" data-mermaid-source="${source}"><pre class="mermaid-fallback">${source}</pre></div>`;
  }
  if (lang === "query") {
    // Same reasoning as mermaid above: rendering a live, filtered list of
    // notes needs the current `notes` array, which markdown-it's
    // synchronous renderer has no access to — so this emits a placeholder
    // carrying the raw filter text; Preview.tsx's effect finds
    // .query-block elements and fills them in, same pattern.
    const source = md.utils.escapeHtml(token.content);
    return `<div class="query-block" data-query-filter="${source}"><pre class="query-fallback">${source}</pre></div>`;
  }
  if (lang === "bibliography") {
    // Same placeholder pattern as query blocks: the list of citations
    // actually used depends on the whole note's content and the citation
    // map, neither of which the fence rule has access to — Preview.tsx's
    // effect scans the rendered note for [@citekey]s and fills this in.
    return `<div class="bibliography-block"></div>`;
  }
  // A raw copy of the code, not the highlighted HTML — the copy button
  // needs the original text, and re-deriving it from the highlighted
  // markup (stripping hljs's <span> tags) would be more fragile than
  // just keeping the source markdown-it already token'd.
  const rawCode = md.utils.escapeHtml(token.content);
  return `<div class="code-block-wrapper"><button type="button" class="code-copy-btn" data-code="${rawCode}">Copy</button>${defaultFenceRule(tokens, idx, options, env, self)}</div>`;
};

export function extractWikilinkRefs(raw: string): WikilinkRef[] {
  return extractWikilinkRefsFromBody(stripFrontmatter(raw));
}

// Every distinct [@citekey] in a note's body, in first-appearance order —
// what a ```bibliography block in that note renders from (see Preview.tsx).
export function extractCitationKeys(raw: string): string[] {
  const body = stripFrontmatter(raw);
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = /\[@([^\s\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
}

export function renderNoteBody(raw: string, env: RenderEnv): string {
  return md.render(stripFrontmatter(raw), env);
}
