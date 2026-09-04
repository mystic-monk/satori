import { BookOpen, Brain, Calendar, FileStack, FileText, LayoutTemplate, Paintbrush } from "lucide-react";

// Same category set GraphView.tsx's node coloring uses, so a type reads
// the same way wherever it shows up (rail icons, History view, etc).
export default function NoteTypeIcon({
  type,
  size = 13,
  className = "",
}: {
  type: string | null;
  size?: number;
  className?: string;
}) {
  const cls = (typeClass: string) => [className, typeClass].filter(Boolean).join(" ");
  switch (type) {
    case "daily":
      return <Calendar size={size} className={cls("type-color-daily")} />;
    case "canvas":
      return <Paintbrush size={size} className={cls("type-color-canvas")} />;
    case "flashcard":
      return <Brain size={size} className={cls("type-color-flashcard")} />;
    case "template":
      return <LayoutTemplate size={size} className={cls("type-color-template")} />;
    case "reference":
      return <BookOpen size={size} className={cls("type-color-reference")} />;
    case null:
      return <FileText size={size} className={className || undefined} />;
    default:
      return <FileStack size={size} className={cls("type-color-other")} />;
  }
}
