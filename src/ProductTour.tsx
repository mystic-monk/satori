import { useEffect, useState } from "react";

interface TourStep {
  // null = an informational step with no real element to point at (e.g.
  // the Command Palette, which has no visible trigger — see the doc
  // comment on TOUR_STEPS below) — rendered centered, no cutout.
  selector: string | null;
  title: string;
  body: string;
}

// Selectors use each element's own `title` attribute where one already
// exists (the rail nav buttons, Settings) rather than nth-child/class-only
// matching — the same attribute already used for each button's own hover
// tooltip, so it's already a stable, meaningful identifier instead of a
// second one invented just for this. `.sidebar-nav`, `.app-topbar-search-
// wrap`, and `.create-button` can all be legitimately absent from the DOM
// (an active search, or a shareToken guest session) — resolveStep below
// treats a missing element as "skip forward automatically," not stuck.
const TOUR_STEPS: TourStep[] = [
  {
    selector: null,
    title: "Welcome to Satori",
    body: "A quick look at where everything lives. Skip any time — this is also replayable later from Settings.",
  },
  {
    selector: '.sidebar-nav button[title="All Notes"]',
    title: "Your notes",
    body: "Every note lives here. Switch views — Journal, Canvas, Graph, Table, Flashcards, and more — with the rest of these buttons.",
  },
  {
    selector: ".app-topbar-search-wrap",
    title: "Search",
    body: "Search every note here, or press ⌘F / Ctrl+F from anywhere to jump straight to it.",
  },
  {
    selector: ".create-button",
    title: "Create",
    body: "New notes, canvases, flashcards, or a note from a template — everything starts here.",
  },
  {
    selector: null,
    title: "Command palette",
    body: "Press ⌘K / Ctrl+K anywhere to jump to any note or action instantly, without leaving the keyboard.",
  },
  {
    selector: '.sidebar-bottom button[title="Settings"]',
    title: "Settings",
    body: "Themes, AI chat providers, and more live here — including a way to replay this tour whenever you want.",
  },
  {
    selector: null,
    title: "That's the basics",
    body: "Every persona also has its own tutorial notes for a deeper dive — find them from the persona button in the top bar. Have fun.",
  },
];

interface ProductTourProps {
  onClose: () => void;
}

interface Placement {
  cutout: { top: number; left: number; width: number; height: number } | null;
  tooltip: { top: number; left: number; transform?: string };
}

function computePlacement(selector: string | null): Placement {
  if (!selector) {
    return { cutout: null, tooltip: { top: window.innerHeight / 2, left: window.innerWidth / 2, transform: "translate(-50%, -50%)" } };
  }
  const el = document.querySelector(selector);
  if (!el) return computePlacement(null);
  const rect = el.getBoundingClientRect();
  const pad = 6;
  const cutout = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  const tooltipWidth = 300;
  const spaceBelow = window.innerHeight - cutout.top - cutout.height;
  const below = spaceBelow > 160;
  const top = below ? cutout.top + cutout.height + 12 : Math.max(12, cutout.top - 12);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - tooltipWidth - 12);
  return { cutout, tooltip: { top, left, transform: below ? undefined : "translateY(-100%)" } };
}

// Step-by-step coach-mark overlay — a dimmed screen with a cutout around
// one real element and a tooltip explaining it, Next/Back/Skip to move
// through TOUR_STEPS above. Same mount convention every other overlay in
// this app uses (a plain conditionally-rendered sibling in App.tsx's
// return, no portal — see ConfirmDialog.tsx/CommandPalette.tsx), but a
// higher z-index (1000, matching .timetable-fullscreen-overlay's "above
// genuinely everything" precedent) since it needs to sit over an open
// modal too, not just the app chrome underneath.
export default function ProductTour({ onClose }: ProductTourProps) {
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>(() => computePlacement(TOUR_STEPS[0].selector));

  const step = TOUR_STEPS[index];

  useEffect(() => {
    function recompute() {
      setPlacement(computePlacement(step.selector));
    }
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [step.selector]);

  function next() {
    if (index >= TOUR_STEPS.length - 1) {
      onClose();
    } else {
      setIndex((i) => i + 1);
    }
  }

  function back() {
    setIndex((i) => Math.max(0, i - 1));
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <div className="product-tour">
      <div
        className="product-tour-cutout"
        style={
          placement.cutout
            ? {
                top: placement.cutout.top,
                left: placement.cutout.left,
                width: placement.cutout.width,
                height: placement.cutout.height,
              }
            : { top: "50%", left: "50%", width: 0, height: 0 }
        }
      />
      <div
        className="product-tour-tooltip"
        style={{ top: placement.tooltip.top, left: placement.tooltip.left, transform: placement.tooltip.transform }}
      >
        <div className="product-tour-step-count">
          {index + 1} / {TOUR_STEPS.length}
        </div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="product-tour-actions">
          <button className="btn-ghost" onClick={onClose}>
            Skip
          </button>
          <div className="product-tour-nav">
            {index > 0 && (
              <button className="btn-ghost" onClick={back}>
                Back
              </button>
            )}
            <button className="btn-primary" onClick={next} autoFocus>
              {index >= TOUR_STEPS.length - 1 ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
