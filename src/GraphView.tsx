import { useEffect, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { fetchLinks, fetchNotes } from "./api";
import { Waypoints } from "lucide-react";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  type: string | null;
}
interface GraphLink {
  source: GraphNode;
  target: GraphNode;
}
interface RawNode {
  id: string;
  title: string;
  type: string | null;
}
interface RawLink {
  source: string;
  target: string;
}

interface GraphViewProps {
  onNavigate: (path: string) => void;
  activePath: string | null;
}

const WIDTH = 800;
const HEIGHT = 560;
const DEFAULT_VIEWBOX = `${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`;
const MAX_LABEL_LEN = 28;

// Same category set as App.tsx's NoteTypeIcon, so a type reads the same
// color wherever it shows up — a class per type rather than an inline
// style, consistent with how the rest of the app's styling works.
function graphNodeTypeClass(type: string | null): string {
  switch (type) {
    case "daily":
      return "graph-node-daily";
    case "canvas":
      return "graph-node-canvas";
    case "flashcard":
      return "graph-node-flashcard";
    case "template":
      return "graph-node-template";
    case "reference":
      return "graph-node-reference";
    case null:
      return "";
    default:
      return "graph-node-other";
  }
}

function truncateLabel(title: string): string {
  return title.length > MAX_LABEL_LEN ? `${title.slice(0, MAX_LABEL_LEN - 1)}…` : title;
}

// "Local" scope is just the active note plus whoever it directly links to
// or is linked from — one hop, not a full traversal. A deeper radius
// starts pulling in most of a well-connected vault anyway, defeating the
// point of "local" as a focused view.
function scopedGraph(rawNodes: RawNode[], rawLinks: RawLink[], mode: "full" | "local", activePath: string | null) {
  if (mode === "full" || !activePath) return { nodes: rawNodes, links: rawLinks };
  const scopeIds = new Set<string>([activePath]);
  for (const l of rawLinks) {
    if (l.source === activePath) scopeIds.add(l.target);
    else if (l.target === activePath) scopeIds.add(l.source);
  }
  return {
    nodes: rawNodes.filter((n) => scopeIds.has(n.id)),
    links: rawLinks.filter((l) => scopeIds.has(l.source) && scopeIds.has(l.target)),
  };
}

export default function GraphView({ onNavigate, activePath }: GraphViewProps) {
  const [rawNodes, setRawNodes] = useState<RawNode[]>([]);
  const [rawLinks, setRawLinks] = useState<RawLink[]>([]);
  const [mode, setMode] = useState<"full" | "local">("full");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [tick, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState(DEFAULT_VIEWBOX);
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  const tickCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchNotes(), fetchLinks()]).then(([notesRes, linksRes]) => {
      if (cancelled) return;
      setRawNodes(notesRes.map((n) => ({ id: n.path, title: n.title, type: n.type })));
      setRawLinks(linksRes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuilds the simulation from scratch whenever the scoped node/link set
  // changes (including a mode switch) — fresh objects rather than reusing
  // prior x/y so switching scope doesn't inherit stale full-graph layout
  // positions that no longer make sense for a much smaller node set.
  useEffect(() => {
    simRef.current?.stop();
    tickCountRef.current = 0;
    setViewBox(DEFAULT_VIEWBOX);
    if (rawNodes.length === 0) {
      setNodes([]);
      setLinks([]);
      return;
    }
    const scoped = scopedGraph(rawNodes, rawLinks, mode, activePath);
    const nodeList: GraphNode[] = scoped.nodes.map((n) => ({ id: n.id, title: n.title, type: n.type }));
    const byId = new Map(nodeList.map((n) => [n.id, n]));
    const linkList = scoped.links
      .filter((l) => byId.has(l.source) && byId.has(l.target))
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! }));

    const sim = forceSimulation(nodeList)
      .force("charge", forceManyBody().strength(-140))
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(linkList)
          .id((d) => d.id)
          .distance(70)
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(32))
      .on("tick", () => {
        setTick((t) => t + 1);
        tickCountRef.current += 1;
        // Recompute the fit on every tick past an initial settle-in
        // window, rather than locking to a single "alpha looks low
        // enough" moment — a weakly-connected node only has the global
        // centering force pulling it back (no link force), so it can keep
        // drifting outward well past the point a one-shot lock would have
        // already frozen the box, ending up clipped outside it. Past
        // tick 40 the simulation's own per-tick movement is already small
        // (alpha decays geometrically), so continuously refitting doesn't
        // read as jittery — it just tracks the last bit of settling.
        if (tickCountRef.current > 40) {
          const xs = nodeList.map((n) => n.x ?? 0);
          const ys = nodeList.map((n) => n.y ?? 0);
          const pad = 70;
          const minX = Math.min(...xs) - pad;
          const maxX = Math.max(...xs) + pad;
          const minY = Math.min(...ys) - pad;
          const maxY = Math.max(...ys) + pad;
          const w = Math.max(maxX - minX, 240);
          const h = Math.max(maxY - minY, 180);
          // Center the fitted box the same way the box itself is centered,
          // rather than anchoring to minX/minY, so a small cluster doesn't
          // end up pinned to one corner.
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          setViewBox(`${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
        }
      });

    simRef.current = sim;
    setNodes(nodeList);
    setLinks(linkList);
    return () => {
      sim.stop();
    };
  }, [rawNodes, rawLinks, mode, activePath]);

  if (rawNodes.length === 0) {
    return (
      <div className="graph-empty">
        <Waypoints size={32} aria-hidden="true" />
        No notes to graph yet.
      </div>
    );
  }

  // A node only "connects" to another once one note links to the other
  // with a [[wikilink]] — that's the one fact this view exists to show,
  // so it's spelled out directly rather than left for someone to guess.
  const connectedIds = new Set<string>();
  if (hoveredId) {
    for (const l of links) {
      if (l.source.id === hoveredId) connectedIds.add(l.target.id);
      else if (l.target.id === hoveredId) connectedIds.add(l.source.id);
    }
  }

  return (
    <div className="graph-view">
      <div className="graph-caption">
        <span>
          Lines connect notes through <code>[[wikilinks]]</code> — hover a note to trace its connections, click to
          open it.
        </span>
        <div className="graph-mode-toggle">
          <button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}>
            Full vault
          </button>
          <button
            className={mode === "local" ? "active" : ""}
            onClick={() => setMode("local")}
            disabled={!activePath}
            title={activePath ? "Just this note's direct connections" : "Open a note first"}
          >
            This note
          </button>
        </div>
      </div>
      {mode === "local" && nodes.length <= 1 ? (
        <div className="graph-empty">
          <Waypoints size={32} aria-hidden="true" />
          This note has no connections yet.
        </div>
      ) : nodes.length === 0 ? (
        <div className="graph-empty">
          <Waypoints size={32} aria-hidden="true" />
          No notes to graph yet.
        </div>
      ) : (
        <svg className="graph-svg" data-tick={tick} viewBox={viewBox}>
          <g className="graph-links">
            {links.map((l, i) => (
              <line
                key={i}
                x1={l.source.x ?? 0}
                y1={l.source.y ?? 0}
                x2={l.target.x ?? 0}
                y2={l.target.y ?? 0}
                className={
                  hoveredId && (l.source.id === hoveredId || l.target.id === hoveredId) ? "graph-link-highlight" : ""
                }
              />
            ))}
          </g>
          <g className="graph-nodes">
            {nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                className={[
                  "graph-node",
                  graphNodeTypeClass(n.type),
                  n.id === activePath ? "graph-node-active" : "",
                  hoveredId && n.id !== hoveredId && !connectedIds.has(n.id) ? "graph-node-dim" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onNavigate(n.id)}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <title>{n.title}</title>
                <circle r={n.id === activePath ? 8 : 5} />
                <text dy={-10}>{truncateLabel(n.title)}</text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
