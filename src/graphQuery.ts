// Same one-condition-per-line, lenient parsing shape as noteQuery.ts's
// ```query blocks (bad lines are just skipped, no error surfaced) — but a
// small amount of comparison syntax is genuinely needed here that
// noteQuery.ts deliberately avoids: "degree" and "connected" aren't note
// frontmatter, they're properties of the graph itself, and a flat
// key:value equality match can't express "more than 5 connections."
// Kept as narrow as that need requires — four condition kinds, no
// AND/OR grouping, no multi-hop traversal (matches GraphView's own
// scopedGraph, whose "local" mode is deliberately one hop, not a full
// traversal).
export interface GraphQueryNode {
  id: string;
  title: string;
  type: string | null;
}

export interface GraphQueryLink {
  source: string;
  target: string;
}

export type ComparisonOp = ">" | ">=" | "<" | "<=" | "=";

export type GraphQueryCondition =
  | { kind: "degree"; op: ComparisonOp; value: number }
  | { kind: "type"; value: string }
  | { kind: "connected"; ref: string }
  | { kind: "isolated" };

const DEGREE_RE = /^\s*degree\s*(>=|<=|>|<|=)\s*(\d+)\s*$/i;
const TYPE_RE = /^\s*type\s*:\s*(.+?)\s*$/i;
const CONNECTED_RE = /^\s*connected\s*:\s*(.+?)\s*$/i;
const ISOLATED_RE = /^\s*isolated\s*$/i;

export function parseGraphQuery(text: string): GraphQueryCondition[] {
  const conditions: GraphQueryCondition[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = DEGREE_RE.exec(line))) {
      conditions.push({ kind: "degree", op: m[1] as ComparisonOp, value: Number(m[2]) });
    } else if ((m = ISOLATED_RE.exec(line))) {
      conditions.push({ kind: "isolated" });
    } else if ((m = CONNECTED_RE.exec(line))) {
      // Strip an optional [[...]] wrapper — connected: [[Note Title]] and
      // connected: some/path.md are both accepted.
      const ref = m[1].replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
      if (ref) conditions.push({ kind: "connected", ref });
    } else if ((m = TYPE_RE.exec(line))) {
      if (m[1]) conditions.push({ kind: "type", value: m[1] });
    }
  }
  return conditions;
}

function compare(actual: number, op: ComparisonOp, expected: number): boolean {
  switch (op) {
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case "=":
      return actual === expected;
  }
}

// Undirected — a link counts toward both endpoints' degree regardless of
// wikilink direction, matching scopedGraph's own symmetric treatment of
// links elsewhere in GraphView.
export function buildDegreeMap(links: GraphQueryLink[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of links) {
    map.set(l.source, (map.get(l.source) ?? 0) + 1);
    map.set(l.target, (map.get(l.target) ?? 0) + 1);
  }
  return map;
}

function resolveRefId(ref: string, nodes: GraphQueryNode[]): string | null {
  const lower = ref.toLowerCase();
  const node = nodes.find((n) => n.id === ref || n.title.toLowerCase() === lower);
  return node?.id ?? null;
}

function directNeighbors(id: string, links: GraphQueryLink[]): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.source === id) out.add(l.target);
    else if (l.target === id) out.add(l.source);
  }
  return out;
}

// Precomputes anything condition-wide (degree map, resolved "connected:"
// neighbor sets) once, rather than redoing that work per node — nodes can
// number in the hundreds, conditions rarely more than a handful.
export function buildQueryMatcher(
  conditions: GraphQueryCondition[],
  nodes: GraphQueryNode[],
  links: GraphQueryLink[]
): (node: GraphQueryNode) => boolean {
  const degreeMap = buildDegreeMap(links);
  const connectedSets = conditions
    .filter((c): c is Extract<GraphQueryCondition, { kind: "connected" }> => c.kind === "connected")
    .map((c) => {
      const id = resolveRefId(c.ref, nodes);
      return id ? directNeighbors(id, links) : new Set<string>();
    });

  return (node: GraphQueryNode) => {
    let connectedIdx = 0;
    for (const cond of conditions) {
      if (cond.kind === "degree") {
        if (!compare(degreeMap.get(node.id) ?? 0, cond.op, cond.value)) return false;
      } else if (cond.kind === "isolated") {
        if ((degreeMap.get(node.id) ?? 0) !== 0) return false;
      } else if (cond.kind === "type") {
        if (node.type !== cond.value) return false;
      } else if (cond.kind === "connected") {
        if (!connectedSets[connectedIdx]!.has(node.id)) return false;
        connectedIdx++;
      }
    }
    return true;
  };
}
