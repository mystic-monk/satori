import { ChevronRight } from "lucide-react";

// Replaces the ▸/▸ text-character toggle every accordion-style panel
// (Properties, Share, Comments, History, Identity) used to swap between —
// a rotating icon reads as more deliberate than a character swap, and
// centralizing it here means all five panels animate identically instead
// of each having its own copy of the same three lines.
export default function DisclosureChevron({ open }: { open: boolean }) {
  return <ChevronRight size={13} className={`disclosure-chevron${open ? " open" : ""}`} aria-hidden="true" />;
}
