import { useEffect, useState } from "react";
import { fetchBacklinks, type BacklinkItem } from "./api";

interface BacklinksProps {
  path: string;
  onNavigate: (path: string) => void;
}

export default function Backlinks({ path, onNavigate }: BacklinksProps) {
  const [items, setItems] = useState<BacklinkItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchBacklinks(path).then((r) => {
      if (!cancelled) setItems(r);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (items.length === 0) {
    return <div className="backlinks-empty">No backlinks yet.</div>;
  }

  return (
    <ul className="backlinks-list">
      {items.map((item) => (
        <li key={item.path} onClick={() => onNavigate(item.path)}>
          <span className="backlink-title">{item.title}</span>
          {item.embed && <span className="backlink-embed-tag">embed</span>}
        </li>
      ))}
    </ul>
  );
}
