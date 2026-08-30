export { splitFrontBack } from "../shared/flashcards.js";

// Standard SM-2 (SuperMemo 2) — the well-known baseline algorithm most
// spaced-repetition tools build on. Uses a 4-button rating (matching
// familiar Anki-style review UI) rather than SM-2's original 0-5 scale;
// each button maps to a representative quality value.
export type Rating = "again" | "hard" | "good" | "easy";

export interface CardState {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

const RATING_QUALITY: Record<Rating, number> = { again: 0, hard: 3, good: 4, easy: 5 };

export function initialCardState(): CardState {
  return { ease: 2.5, intervalDays: 0, repetitions: 0 };
}

export function nextCardState(prev: CardState, rating: Rating): CardState {
  const q = RATING_QUALITY[rating];
  let { ease, intervalDays, repetitions } = prev;

  // The standard SM-2 ease update — a "good"/"easy" review nudges ease up
  // slightly, "hard" nudges it down, "again" drops it more. Never below
  // 1.3 (SM-2's own floor — an ease that low would make intervals shrink
  // instead of grow, defeating the point).
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  if (q < 3) {
    // "Again" resets progress — the whole point of spaced repetition is
    // that a failed recall means the card wasn't actually learned yet.
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
    repetitions += 1;
  }

  return { ease, intervalDays, repetitions };
}

