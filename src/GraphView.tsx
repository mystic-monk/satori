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

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
}
interface GraphLink {
  source: GraphNode;
  target: GraphNode;
}

interface GraphViewProps {
  onNavigate: (path: string) => void;
  activePath: string | null;
}

const WIDTH = 800;
const HEIGHT = 560;

export default function GraphView({ onNavigate, activePath }: GraphViewProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [tick, setTick] = useState(0);
  const simRef = useRef<Simulation<GraphNode, undefined> | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchNotes(), fetchLinks()]).then(([notesRes, linksRes]) => {
      if (cancelled) return;
      const nodeList: GraphNode[] = notesRes.map((n) => ({ id: n.path, title: n.title }));
      const byId = new Map(nodeList.map((n) => [n.id, n]));
      const linkList = linksRes
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
        .force("collide", forceCollide(26))
        .on("tick", () => setTick((t) => t + 1));

      simRef.current = sim;
      setNodes(nodeList);
      setLinks(linkList);
    });
    return () => {
      cancelled = true;
      simRef.current?.stop();
    };
  }, []);

  if (nodes.length === 0) {
    return <div className="graph-empty">No notes to graph yet.</div>;
  }

  return (
    <svg
      className="graph-svg"
      data-tick={tick}
      viewBox={`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`}
    >
      <g className="graph-links">
        {links.map((l, i) => (
          <line key={i} x1={l.source.x ?? 0} y1={l.source.y ?? 0} x2={l.target.x ?? 0} y2={l.target.y ?? 0} />
        ))}
      </g>
      <g className="graph-nodes">
        {nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
            className={`graph-node ${n.id === activePath ? "graph-node-active" : ""}`}
            onClick={() => onNavigate(n.id)}
          >
            <circle r={n.id === activePath ? 8 : 5} />
            <text dy={-10}>{n.title}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
