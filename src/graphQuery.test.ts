import { describe, expect, it } from "vitest";
import { buildDegreeMap, buildQueryMatcher, parseGraphQuery, type GraphQueryNode, type GraphQueryLink } from "./graphQuery";

function node(overrides: Partial<GraphQueryNode>): GraphQueryNode {
  return { id: "a.md", title: "A", type: null, ...overrides };
}

describe("parseGraphQuery", () => {
  it("parses each degree comparison operator", () => {
    expect(parseGraphQuery("degree > 5")).toEqual([{ kind: "degree", op: ">", value: 5 }]);
    expect(parseGraphQuery("degree >= 5")).toEqual([{ kind: "degree", op: ">=", value: 5 }]);
    expect(parseGraphQuery("degree < 5")).toEqual([{ kind: "degree", op: "<", value: 5 }]);
    expect(parseGraphQuery("degree <= 5")).toEqual([{ kind: "degree", op: "<=", value: 5 }]);
    expect(parseGraphQuery("degree = 5")).toEqual([{ kind: "degree", op: "=", value: 5 }]);
  });

  it("parses type: lines", () => {
    expect(parseGraphQuery("type: project")).toEqual([{ kind: "type", value: "project" }]);
  });

  it("parses connected: with a bracketed title, stripping the brackets", () => {
    expect(parseGraphQuery("connected: [[Tutorial]]")).toEqual([{ kind: "connected", ref: "Tutorial" }]);
  });

  it("parses connected: with a bare path", () => {
    expect(parseGraphQuery("connected: some/path.md")).toEqual([{ kind: "connected", ref: "some/path.md" }]);
  });

  it("parses isolated with no arguments", () => {
    expect(parseGraphQuery("isolated")).toEqual([{ kind: "isolated" }]);
  });

  it("is case-insensitive on keywords", () => {
    expect(parseGraphQuery("DEGREE > 2")).toEqual([{ kind: "degree", op: ">", value: 2 }]);
    expect(parseGraphQuery("Isolated")).toEqual([{ kind: "isolated" }]);
  });

  it("skips blank lines and malformed lines without erroring", () => {
    expect(parseGraphQuery("degree > 2\n\nnot a real condition\ntype: daily")).toEqual([
      { kind: "degree", op: ">", value: 2 },
      { kind: "type", value: "daily" },
    ]);
  });

  it("parses multiple lines into multiple conditions (implicit AND)", () => {
    expect(parseGraphQuery("degree > 1\ntype: project")).toEqual([
      { kind: "degree", op: ">", value: 1 },
      { kind: "type", value: "project" },
    ]);
  });
});

describe("buildDegreeMap", () => {
  it("counts each link toward both endpoints, undirected", () => {
    const links: GraphQueryLink[] = [
      { source: "a.md", target: "b.md" },
      { source: "c.md", target: "a.md" },
    ];
    const map = buildDegreeMap(links);
    expect(map.get("a.md")).toBe(2);
    expect(map.get("b.md")).toBe(1);
    expect(map.get("c.md")).toBe(1);
  });

  it("a node with no links has no entry (treated as degree 0 by callers)", () => {
    const map = buildDegreeMap([]);
    expect(map.get("a.md")).toBeUndefined();
  });
});

describe("buildQueryMatcher", () => {
  const nodes: GraphQueryNode[] = [
    node({ id: "hub.md", title: "Hub", type: "project" }),
    node({ id: "leaf1.md", title: "Leaf One", type: "daily" }),
    node({ id: "leaf2.md", title: "Leaf Two", type: "daily" }),
    node({ id: "island.md", title: "Island", type: null }),
  ];
  const links: GraphQueryLink[] = [
    { source: "hub.md", target: "leaf1.md" },
    { source: "hub.md", target: "leaf2.md" },
  ];

  it("matches degree conditions", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("degree > 1"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["hub.md"]);
  });

  it("matches isolated nodes only", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("isolated"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["island.md"]);
  });

  it("matches type conditions", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("type: daily"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["leaf1.md", "leaf2.md"]);
  });

  it("resolves connected: by title and returns direct neighbors only", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("connected: [[Hub]]"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["leaf1.md", "leaf2.md"]);
  });

  it("resolves connected: by path", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("connected: hub.md"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["leaf1.md", "leaf2.md"]);
  });

  it("an unresolvable connected: ref matches nothing", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("connected: [[Nonexistent]]"), nodes, links);
    expect(nodes.filter(matcher)).toEqual([]);
  });

  it("combines multiple conditions with AND", () => {
    const matcher = buildQueryMatcher(parseGraphQuery("degree > 0\ntype: daily"), nodes, links);
    expect(nodes.filter(matcher).map((n) => n.id)).toEqual(["leaf1.md", "leaf2.md"]);
  });

  it("an empty condition list matches every node", () => {
    const matcher = buildQueryMatcher([], nodes, links);
    expect(nodes.filter(matcher)).toHaveLength(4);
  });
});
