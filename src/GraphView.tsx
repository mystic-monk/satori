import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type ForceLink,
  type ForceManyBody,
} from "d3-force";
import { fetchLinks, fetchNotes } from "./api";
import { Waypoints, Maximize2, MoreHorizontal, ChevronRight, Download } from "lucide-react";
import { IS_TAURI } from "./platform";
import { buildQueryMatcher, parseGraphQuery } from "./graphQuery";

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
const MIN_ZOOM_W = 80;
const MAX_ZOOM_W = 6000;

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

// Sentinel for `type: null` (untyped notes) — used as a Set/Map key
// wherever hiddenTypes/typeCounts need one, since a real Map/Set can't key
// on null the way an object property could.
const NONE_TYPE = "__none__";

const TYPE_LABELS: Record<string, string> = {
  daily: "Journal",
  canvas: "Canvas",
  flashcard: "Flashcards",
  template: "Templates",
  reference: "References",
  [NONE_TYPE]: "Untyped",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

const DEFAULT_CHARGE = 140;
const DEFAULT_LINK_DISTANCE = 70;

// Same collapsible-section shape as Logseq's graph settings panel — each
// section remembers its own open/closed state independently rather than
// the whole panel being one flat list.
function PanelSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="graph-panel-section">
      <button className="graph-panel-section-header" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={12} className={`graph-panel-chevron ${open ? "open" : ""}`} />
        {title}
      </button>
      {open && <div className="graph-panel-section-body">{children}</div>}
    </div>
  );
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

function parseViewBox(vb: string): [number, number, number, number] {
  const [x, y, w, h] = vb.split(" ").map(Number);
  return [x, y, w, h];
}

export default function GraphView({ onNavigate, activePath }: GraphViewProps) {
  const [rawNodes, setRawNodes] = useState<RawNode[]>([]);
  const [rawLinks, setRawLinks] = useState<RawLink[]>([]);
  const [mode, setMode] = useState<"full" | "local">("full");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [tick, setTick] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [viewBox, setViewBox] = useState(DEFAULT_VIEWBOX);
  const [panelOpen, setPanelOpen] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [queryText, setQueryText] = useState("");
  const [chargeStrength, setChargeStrength] = useState(DEFAULT_CHARGE);
  const [linkDistance, setLinkDistance] = useState(DEFAULT_LINK_DISTANCE);
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null);
  // Persistent handles on the two tunable forces — Forces sliders call
  // .strength()/.distance() straight on these rather than rebuilding the
  // whole force pipeline per drag tick, which would also reset every
  // node's accumulated position.
  const chargeForceRef = useRef<ForceManyBody<GraphNode> | null>(null);
  const linkForceRef = useRef<ForceLink<GraphNode, GraphLink> | null>(null);
  const forceSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickCountRef = useRef(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Once someone drags a node, pans, or zooms, the auto-fit-to-content
  // behavior below (which recomputes viewBox every tick) would otherwise
  // fight whatever they just did — a dragged node reheats the simulation,
  // which would keep re-centering the view around it. A ref (not state):
  // read inside the tick closure, set from event handlers, no re-render
  // of its own needed either way.
  const userAdjustedViewRef = useRef(false);
  // Background-pan tracking, plain mutable object rather than state — high-
  // frequency pointermove updates during a pan shouldn't each trigger a
  // full re-render bookkeeping pass on top of the setViewBox they already
  // cause.
  const panRef = useRef<{ startClientX: number; startClientY: number; startVb: [number, number, number, number] } | null>(
    null
  );

  // What the Nodes section's type checkboxes list and count — scoped by
  // Full-vault/This-note the same way the actual rendered graph is, but
  // deliberately NOT filtered by hiddenTypes itself, so unchecking a type
  // doesn't make its own checkbox disappear.
  const typeCounts = useMemo(() => {
    const scoped = scopedGraph(rawNodes, rawLinks, mode, activePath);
    const m = new Map<string, number>();
    for (const n of scoped.nodes) {
      const key = n.type ?? NONE_TYPE;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [rawNodes, rawLinks, mode, activePath]);

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
    userAdjustedViewRef.current = false;
    setPinnedIds(new Set());
    setViewBox(DEFAULT_VIEWBOX);
    if (rawNodes.length === 0) {
      setNodes([]);
      setLinks([]);
      return;
    }
    const scoped = scopedGraph(rawNodes, rawLinks, mode, activePath);
    const visibleScoped = scoped.nodes.filter((n) => !hiddenTypes.has(n.type ?? NONE_TYPE));
    const nodeList: GraphNode[] = visibleScoped.map((n) => ({ id: n.id, title: n.title, type: n.type }));
    const byId = new Map(nodeList.map((n) => [n.id, n]));
    const linkList = scoped.links
      .filter((l) => byId.has(l.source) && byId.has(l.target))
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)! }));

    const chargeForce = forceManyBody<GraphNode>().strength(-chargeStrength);
    const linkForce = forceLink<GraphNode, GraphLink>(linkList)
      .id((d) => d.id)
      .distance(linkDistance);
    chargeForceRef.current = chargeForce;
    linkForceRef.current = linkForce;

    const sim = forceSimulation(nodeList)
      .velocityDecay(0.55) // more damping than d3's 0.4 default — settles
      // down quietly instead of the initial charge burst sending weakly-
      // connected nodes flying outward before the link/center forces have
      // a chance to rein them back in.
      .alphaDecay(0.04) // faster than the ~0.023 default, so the sim
      // reaches a settled low-alpha state in noticeably fewer ticks —
      // less total time spent visibly drifting/jittering.
      .force("charge", chargeForce)
      .force("link", linkForce)
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
        // Skipped entirely once the user has manually framed their own
        // view (dragged/panned/zoomed) — seeing that gesture immediately
        // overridden by an auto-fit would feel broken, not helpful.
        if (tickCountRef.current > 40 && !userAdjustedViewRef.current) {
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
    // chargeStrength/linkDistance deliberately excluded — they only seed
    // the initial force values here; the Forces sliders update the live
    // chargeForceRef/linkForceRef directly instead of forcing a full
    // simulation rebuild (which would reset every node's position) on
    // every drag tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, rawLinks, mode, activePath, hiddenTypes]);

  // Native (not React's onWheel) so preventDefault reliably stops the page
  // itself from scrolling while zooming the graph — React attaches wheel
  // listeners as passive by default, which silently no-ops preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      userAdjustedViewRef.current = true;
      const [vbX, vbY, vbW, vbH] = parseViewBox(viewBox);
      const rect = svg!.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const newW = Math.min(MAX_ZOOM_W, Math.max(MIN_ZOOM_W, vbW * factor));
      const newH = newW * (vbH / vbW);
      // Zoom toward the cursor, not the box center — the point under the
      // mouse stays under the mouse, same feel as Figma/Miro/any canvas
      // app rather than a plain "zoom in place" that drifts the content
      // out from under you.
      const cx = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
      const cy = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
      const newX = cx - (cx - vbX) * (newW / vbW);
      const newY = cy - (cy - vbY) * (newH / vbH);
      setViewBox(`${newX} ${newY} ${newW} ${newH}`);
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewBox]);

  function clientToSvgPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    const [vbX, vbY, vbW, vbH] = parseViewBox(viewBox);
    return {
      x: vbX + ((clientX - rect.left) / rect.width) * vbW,
      y: vbY + ((clientY - rect.top) / rect.height) * vbH,
    };
  }

  // Dragging reheats the simulation (alphaTarget) instead of just moving
  // the one node — neighbors nudge out of the way and springs stretch, the
  // actual "pull the nodes" playfulness this was asked for, not a static
  // repositioning. fx/fy (d3-force's pinned-position fields) are released
  // on pointerup unless the node's been explicitly double-click-pinned.
  // Click still needs to open the note — a plain click is a pointerdown
  // and pointerup at essentially the same spot, so onClick can't just
  // check "did a drag happen" via draggingId (already cleared to null by
  // the pointerup handler that runs before the click fires). Tracked by
  // distance instead: past a few px of movement it's a drag, and the
  // click that follows the eventual pointerup is suppressed.
  const dragMovedRef = useRef(false);
  // A real double-click fires click, click, then dblclick in sequence —
  // navigating on the first click (as a plain click handler would)
  // leaves the graph before the second click or the dblclick ever
  // register, so double-click-to-pin could never fire. Standard fix:
  // delay navigation briefly and cancel it if a second click (handled by
  // onDoubleClick below) arrives first.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onNodePointerDown(e: React.PointerEvent, n: GraphNode) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragMovedRef.current = false;
    setDraggingId(n.id);
    userAdjustedViewRef.current = true;
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.3).restart();
  }

  function onNodePointerMove(e: React.PointerEvent, n: GraphNode) {
    if (draggingId !== n.id) return;
    const p = clientToSvgPoint(e.clientX, e.clientY);
    if (Math.hypot(p.x - (n.fx ?? p.x), p.y - (n.fy ?? p.y)) > 1) dragMovedRef.current = true;
    n.fx = p.x;
    n.fy = p.y;
  }

  function endNodeDrag(n: GraphNode) {
    setDraggingId(null);
    simRef.current?.alphaTarget(0);
    if (!pinnedIds.has(n.id)) {
      n.fx = null;
      n.fy = null;
    }
  }

  function onNodeDoubleClick(e: React.MouseEvent, n: GraphNode) {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(n.id)) {
        next.delete(n.id);
        n.fx = null;
        n.fy = null;
      } else {
        next.add(n.id);
        n.fx = n.x;
        n.fy = n.y;
      }
      return next;
    });
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    userAdjustedViewRef.current = true;
    panRef.current = { startClientX: e.clientX, startClientY: e.clientY, startVb: parseViewBox(viewBox) };
    setIsPanning(true);
  }

  function onBackgroundPointerMove(e: React.PointerEvent) {
    if (!panRef.current) return;
    const { startClientX, startClientY, startVb } = panRef.current;
    const rect = svgRef.current!.getBoundingClientRect();
    const [vbX, vbY, vbW, vbH] = startVb;
    const dx = ((e.clientX - startClientX) / rect.width) * vbW;
    const dy = ((e.clientY - startClientY) / rect.height) * vbH;
    setViewBox(`${vbX - dx} ${vbY - dy} ${vbW} ${vbH}`);
  }

  function onBackgroundPointerUp() {
    panRef.current = null;
    setIsPanning(false);
  }

  function resetView() {
    userAdjustedViewRef.current = false;
    tickCountRef.current = 0;
    setViewBox(DEFAULT_VIEWBOX);
    setPinnedIds((prev) => {
      for (const n of nodes) {
        if (prev.has(n.id)) {
          n.fx = null;
          n.fy = null;
        }
      }
      return new Set();
    });
    simRef.current?.alphaTarget(0.3).restart();
    setTimeout(() => simRef.current?.alphaTarget(0), 300);
  }

  // Reheat-then-settle, debounced — a slider fires many onChange events per
  // drag, and each one nudging the simulation back to alphaTarget(0) after
  // a fixed delay (rather than letting the first timer win) keeps it warm
  // for the whole gesture instead of freezing mid-drag.
  function reheatBriefly() {
    simRef.current?.alphaTarget(0.3).restart();
    if (forceSettleTimerRef.current) clearTimeout(forceSettleTimerRef.current);
    forceSettleTimerRef.current = setTimeout(() => simRef.current?.alphaTarget(0), 300);
  }

  function onChargeChange(value: number) {
    setChargeStrength(value);
    chargeForceRef.current?.strength(-value);
    reheatBriefly();
  }

  function onLinkDistanceChange(value: number) {
    setLinkDistance(value);
    linkForceRef.current?.distance(value);
    reheatBriefly();
  }

  function resetForces() {
    onChargeChange(DEFAULT_CHARGE);
    onLinkDistanceChange(DEFAULT_LINK_DISTANCE);
  }

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  // Rasterizes the current view (not the whole graph — whatever's actually
  // in the viewBox right now, panned/zoomed/filtered as-is) to a PNG via an
  // off-DOM canvas. Browser-only: an <a download> click is inert inside a
  // Tauri webview (see export.ts's downloadFile doc comment) and this
  // graph is view-only info, not a file worth wiring a native Save dialog
  // for.
  function exportPng() {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(rect.width));
    clone.setAttribute("height", String(rect.height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#111318";
    const [vx, vy, vw, vh] = parseViewBox(viewBox);
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(vx));
    bgRect.setAttribute("y", String(vy));
    bgRect.setAttribute("width", String(vw));
    bgRect.setAttribute("height", String(vh));
    bgRect.setAttribute("fill", bg);
    clone.insertBefore(bgRect, clone.firstChild);
    const svgStr = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "graph.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    };
    img.src = url;
  }

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

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const matchIds = trimmedQuery ? new Set(nodes.filter((n) => n.title.toLowerCase().includes(trimmedQuery)).map((n) => n.id)) : null;

  // Query conditions (degree/type/connected/isolated) are a second,
  // independent filter from plain-text Search above — when both are
  // active they combine as AND (intersected below) rather than one
  // silently replacing the other.
  const queryConditions = parseGraphQuery(queryText);
  const queryMatchIds =
    queryConditions.length > 0
      ? new Set(
          nodes
            .filter(
              buildQueryMatcher(
                queryConditions,
                nodes,
                links.map((l) => ({ source: l.source.id, target: l.target.id }))
              )
            )
            .map((n) => n.id)
        )
      : null;
  const effectiveMatchIds =
    matchIds && queryMatchIds
      ? new Set([...matchIds].filter((id) => queryMatchIds.has(id)))
      : (matchIds ?? queryMatchIds);

  const sortedTypes = Array.from(typeCounts.keys()).sort((a, b) => {
    if (a === NONE_TYPE) return 1;
    if (b === NONE_TYPE) return -1;
    return typeLabel(a).localeCompare(typeLabel(b));
  });

  return (
    <div className="graph-view">
      <div className="graph-caption">
        <span>
          Lines connect notes through <code>[[wikilinks]]</code> — hover a note to trace its connections, drag one to
          nudge the layout, double-click to pin it in place, click to open it.
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
        <button className="graph-reset-view" onClick={resetView} title="Reset pan/zoom and unpin every node">
          <Maximize2 size={13} /> Reset view
        </button>
        <button
          className={`graph-panel-toggle ${panelOpen ? "active" : ""}`}
          onClick={() => setPanelOpen((o) => !o)}
          title="Graph settings"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {mode === "local" && nodes.length <= 1 ? (
        <div className="graph-empty">
          <Waypoints size={32} aria-hidden="true" />
          This note has no connections yet.
        </div>
      ) : nodes.length === 0 && typeCounts.size > 0 ? (
        <div className="graph-empty">
          <Waypoints size={32} aria-hidden="true" />
          Every note is filtered out — check the type filters in graph settings.
        </div>
      ) : nodes.length === 0 ? (
        <div className="graph-empty">
          <Waypoints size={32} aria-hidden="true" />
          No notes to graph yet.
        </div>
      ) : (
        <div className="graph-canvas-wrap">
          <svg
            ref={svgRef}
            className={`graph-svg ${isPanning ? "graph-panning" : ""}`}
            data-tick={tick}
            viewBox={viewBox}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onBackgroundPointerMove}
            onPointerUp={onBackgroundPointerUp}
          >
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
              {nodes.map((n) => {
                const dim = hoveredId
                  ? n.id !== hoveredId && !connectedIds.has(n.id)
                  : effectiveMatchIds
                    ? !effectiveMatchIds.has(n.id)
                    : false;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                    className={[
                      "graph-node",
                      graphNodeTypeClass(n.type),
                      n.id === activePath ? "graph-node-active" : "",
                      n.id === draggingId ? "graph-node-dragging" : "",
                      pinnedIds.has(n.id) ? "graph-node-pinned" : "",
                      dim ? "graph-node-dim" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      if (dragMovedRef.current || clickTimerRef.current) return;
                      clickTimerRef.current = setTimeout(() => {
                        clickTimerRef.current = null;
                        onNavigate(n.id);
                      }, 220);
                    }}
                    onDoubleClick={(e) => {
                      if (clickTimerRef.current) {
                        clearTimeout(clickTimerRef.current);
                        clickTimerRef.current = null;
                      }
                      onNodeDoubleClick(e, n);
                    }}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                    onPointerMove={(e) => onNodePointerMove(e, n)}
                    onPointerUp={() => endNodeDrag(n)}
                    onPointerCancel={() => endNodeDrag(n)}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <title>{n.title}</title>
                    {pinnedIds.has(n.id) && (
                      <circle className="graph-node-pin-ring" r={(n.id === activePath ? 8 : 5) + 5} />
                    )}
                    <circle r={n.id === activePath ? 8 : 5} />
                    <text dy={-10}>{truncateLabel(n.title)}</text>
                  </g>
                );
              })}
            </g>
          </svg>
          {panelOpen && (
            <aside className="graph-settings-panel">
              <PanelSection title={`Nodes · ${nodes.length}`}>
                <div className="graph-panel-type-list">
                  {sortedTypes.map((type) => (
                    <label key={type} className="graph-panel-type-row">
                      <input
                        type="checkbox"
                        checked={!hiddenTypes.has(type)}
                        onChange={() => toggleType(type)}
                      />
                      <span className={`graph-panel-type-dot ${graphNodeTypeClass(type === NONE_TYPE ? null : type)}`} />
                      {typeLabel(type)}
                      <span className="graph-panel-type-count">{typeCounts.get(type)}</span>
                    </label>
                  ))}
                </div>
                {hiddenTypes.size > 0 && (
                  <button className="graph-panel-link-btn" onClick={() => setHiddenTypes(new Set())}>
                    Show all types
                  </button>
                )}
              </PanelSection>
              <PanelSection title="Search" defaultOpen={false}>
                <input
                  className="graph-panel-search"
                  type="text"
                  placeholder="Find a note…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {trimmedQuery && <div className="graph-panel-hint">{matchIds?.size ?? 0} match{matchIds?.size === 1 ? "" : "es"}</div>}
              </PanelSection>
              <PanelSection title="Query" defaultOpen={false}>
                <textarea
                  className="graph-panel-search graph-panel-query"
                  placeholder={"degree > 5\ntype: project\nconnected: [[Note]]\nisolated"}
                  rows={4}
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                />
                {queryConditions.length > 0 && (
                  <div className="graph-panel-hint">
                    {queryMatchIds?.size ?? 0} match{queryMatchIds?.size === 1 ? "" : "es"}
                  </div>
                )}
              </PanelSection>
              <PanelSection title="Forces" defaultOpen={false}>
                <label className="graph-panel-slider-row">
                  Charge strength
                  <input
                    type="range"
                    min={40}
                    max={300}
                    value={chargeStrength}
                    onChange={(e) => onChargeChange(Number(e.target.value))}
                  />
                </label>
                <label className="graph-panel-slider-row">
                  Link distance
                  <input
                    type="range"
                    min={30}
                    max={160}
                    value={linkDistance}
                    onChange={(e) => onLinkDistanceChange(Number(e.target.value))}
                  />
                </label>
                <button className="graph-panel-link-btn" onClick={resetForces}>
                  Reset forces
                </button>
              </PanelSection>
              {!IS_TAURI && (
                <PanelSection title="Export" defaultOpen={false}>
                  <button className="graph-panel-export-btn" onClick={exportPng}>
                    <Download size={13} /> Export as PNG
                  </button>
                </PanelSection>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
