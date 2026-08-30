import { useEffect, useState } from "react";
import { fetchDueCards, fetchNote, reviewCard, type DueCard, type Rating } from "./api";
import { parseFrontmatter } from "../shared/frontmatter";
import { splitFrontBack } from "../shared/flashcards";

interface FlashcardReviewProps {
  shareToken?: string | null;
}

// A type: flashcard note's body is rendered as plain text here, not full
// markdown — deliberately simple for a first version (the review UI's job
// is showing a question and a rating, not rich formatting); revisit if
// that turns out to matter in practice.
export default function FlashcardReview({ shareToken }: FlashcardReviewProps) {
  const [queue, setQueue] = useState<DueCard[] | null>(null);
  const [card, setCard] = useState<{ front: string; back: string | null } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  useEffect(() => {
    fetchDueCards().then(setQueue);
  }, []);

  useEffect(() => {
    if (!queue || queue.length === 0) {
      setCard(null);
      return;
    }
    let cancelled = false;
    setRevealed(false);
    fetchNote(queue[0].path, shareToken).then((note) => {
      if (cancelled) return;
      const { body } = parseFrontmatter(note.raw);
      setCard(splitFrontBack(body));
    });
    return () => {
      cancelled = true;
    };
  }, [queue, shareToken]);

  async function rate(rating: Rating) {
    if (!queue || queue.length === 0) return;
    await reviewCard(queue[0].path, rating);
    setReviewedCount((c) => c + 1);
    setQueue(queue.slice(1));
  }

  if (queue === null) {
    return <div className="flashcard-review flashcard-empty-state">Loading due cards…</div>;
  }

  if (queue.length === 0) {
    return (
      <div className="flashcard-review flashcard-empty-state">
        <h2>All done</h2>
        <p>
          {reviewedCount > 0
            ? `Reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"}.`
            : "No cards are due right now — add a note with type: flashcard to get started."}
        </p>
      </div>
    );
  }

  return (
    <div className="flashcard-review">
      <div className="flashcard-progress">{queue.length} due</div>
      <div className="flashcard-card">
        <div className="flashcard-front">{card?.front ?? "Loading…"}</div>
        {revealed && (
          <div className="flashcard-back">
            {card?.back ?? <span className="flashcard-no-back">No "---" separator found — nothing to reveal.</span>}
          </div>
        )}
      </div>
      {!revealed ? (
        <button className="flashcard-reveal" onClick={() => setRevealed(true)} autoFocus>
          Show Answer
        </button>
      ) : (
        <div className="flashcard-ratings">
          <button onClick={() => rate("again")}>Again</button>
          <button onClick={() => rate("hard")}>Hard</button>
          <button onClick={() => rate("good")}>Good</button>
          <button onClick={() => rate("easy")}>Easy</button>
        </div>
      )}
    </div>
  );
}
