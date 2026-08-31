import { BookOpen, Brain, Calendar, FileStack, FileText, LayoutTemplate, Paintbrush } from "lucide-react";

// Same category set GraphView.tsx's node coloring uses, so a type reads
// the same way wherever it shows up (rail icons, History view, etc).
export default function NoteTypeIcon({ type }: { type: string | null }) {
  switch (type) {
    case "daily":
      return <Calendar size={13} className="type-color-daily" />;
    case "canvas":
      return <Paintbrush size={13} className="type-color-canvas" />;
    case "flashcard":
      return <Brain size={13} className="type-color-flashcard" />;
    case "template":
      return <LayoutTemplate size={13} className="type-color-template" />;
    case "reference":
      return <BookOpen size={13} className="type-color-reference" />;
    case null:
      return <FileText size={13} />;
    default:
      return <FileStack size={13} className="type-color-other" />;
  }
}
