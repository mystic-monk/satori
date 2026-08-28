import { useEffect, useState } from "react";
import { fetchHistory, type HistoryEntry } from "./api";

interface HistoryPanelProps {
  path: string;
  shareToken?: string | null;
}

export default function HistoryPanel({ path, shareToken }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    if (open) fetchHistory(path, shareToken).then(setEntries);
  }, [path, open, shareToken]);

  return (
    <div className="history-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} History
      </button>
      {open && (
        <ul className="history-list">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="history-authors">{e.authors.map((a) => a.name).join(", ")}</span>
              <span className="history-time">{new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="history-empty">No recorded changes yet.</li>}
        </ul>
      )}
    </div>
  );
}
