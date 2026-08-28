import { useEffect, useState } from "react";
import { fetchBacklinks, type BacklinkItem } from "./api";
import { activateOnEnterOrSpace } from "./a11y";

interface BacklinksProps {
  path: string;
  onNavigate: (path: string) => void;
  shareToken?: string | null;
}

export default function Backlinks({ path, onNavigate, shareToken }: BacklinksProps) {
  const [items, setItems] = useState<BacklinkItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchBacklinks(path, shareToken).then((r) => {
      if (!cancelled) setItems(r);
    });
    return () => {
      cancelled = true;
    };
  }, [path, shareToken]);

  if (items.length === 0) {
    return <div className="backlinks-empty">No backlinks yet.</div>;
  }

  return (
    <ul className="backlinks-list">
      {items.map((item) => (
        <li
          key={item.path}
          onClick={() => onNavigate(item.path)}
          onKeyDown={(e) => activateOnEnterOrSpace(e, () => onNavigate(item.path))}
          role="button"
          tabIndex={0}
        >
          <span className="backlink-title">{item.title}</span>
          {item.embed && <span className="backlink-embed-tag">embed</span>}
        </li>
      ))}
    </ul>
  );
}
