import { useEffect, useState } from "react";
import { fetchRelated, type SimilarNote } from "./api";
import { activateOnEnterOrSpace } from "./a11y";

interface RelatedNotesProps {
  path: string;
  onNavigate: (path: string) => void;
  shareToken?: string | null;
}

// Same shape as Backlinks.tsx on purpose — this panel sits right below
// it and should feel like the same kind of thing, just surfacing notes
// that are *semantically* close instead of explicitly wikilinked.
export default function RelatedNotes({ path, onNavigate, shareToken }: RelatedNotesProps) {
  const [items, setItems] = useState<SimilarNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchRelated(path, shareToken).then((r) => {
      if (!cancelled) setItems(r);
    });
    return () => {
      cancelled = true;
    };
  }, [path, shareToken]);

  if (items.length === 0) {
    return <div className="backlinks-empty">No related notes yet.</div>;
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
        </li>
      ))}
    </ul>
  );
}
