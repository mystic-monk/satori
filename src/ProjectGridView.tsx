import { useMemo } from "react";
import { FolderKanban, Plus } from "lucide-react";
import type { NoteListItem } from "./api";

interface ProjectGridViewProps {
  notes: NoteListItem[];
  onNavigate: (path: string, title?: string, type?: string | null) => void;
  onNewProject: () => void;
}

// Same tile-grid shape as CanvasGridView — every type: project note as a
// card, plus a "+ New Project" tile. A project here is a plain note (the
// existing Project template: type: project, a live ```query block
// listing everything with project: [[Title]]) — not a folder. See the
// project/folder architecture discussion this was built from: a note
// belonging to more than one project at once, a project rename not
// needing to move any files, and project-scoped sharing/workspace access
// already being built entirely on this relation all argue against ever
// making this folder-backed.
export default function ProjectGridView({ notes, onNavigate, onNewProject }: ProjectGridViewProps) {
  const projectNotes = useMemo(
    () => notes.filter((n) => n.type === "project").sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  );

  return (
    <div className="tile-grid-view">
      <div className="tile-grid">
        <button className="tile tile-new" onClick={onNewProject}>
          <Plus size={28} aria-hidden="true" />
          <span>New Project</span>
        </button>
        {projectNotes.map((n) => (
          <button key={n.path} className="tile" onClick={() => onNavigate(n.path, n.title, n.type)}>
            <FolderKanban size={28} className="tile-icon" aria-hidden="true" />
            <span className="tile-title">{n.title}</span>
            <span className="tile-date">{new Date(n.updatedAt).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
