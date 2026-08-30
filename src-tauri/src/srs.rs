// Mirrors server/srs.ts exactly — see that file for the algorithm
// rationale (standard SM-2, 4-button rating mapped to representative
// quality values).
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rating {
    Again,
    Hard,
    Good,
    Easy,
}

impl Rating {
    fn quality(self) -> f64 {
        match self {
            Rating::Again => 0.0,
            Rating::Hard => 3.0,
            Rating::Good => 4.0,
            Rating::Easy => 5.0,
        }
    }
}

#[derive(Clone, Copy)]
pub struct CardState {
    pub ease: f64,
    pub interval_days: f64,
    pub repetitions: i64,
}

pub fn initial_card_state() -> CardState {
    CardState { ease: 2.5, interval_days: 0.0, repetitions: 0 }
}

pub fn next_card_state(prev: CardState, rating: Rating) -> CardState {
    let q = rating.quality();
    let mut ease = prev.ease + (0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02));
    if ease < 1.3 {
        ease = 1.3;
    }

    let (interval_days, repetitions) = if q < 3.0 {
        (1.0, 0)
    } else if prev.repetitions == 0 {
        (1.0, prev.repetitions + 1)
    } else if prev.repetitions == 1 {
        (6.0, prev.repetitions + 1)
    } else {
        ((prev.interval_days * ease).round(), prev.repetitions + 1)
    };

    CardState { ease, interval_days, repetitions }
}

// Convention (see server/srs.ts / src/FlashcardReview.tsx): a flashcard
// note's body is the front, then a line containing exactly "---", then
// the back. Not called from application code — the review UI reads raw
// content via the existing read_note command and splits it client-side,
// same as the browser deployment — kept here (tested below) so the Rust
// and TS implementations stay verified against the same behavior rather
// than silently drifting if either one changes.
#[allow(dead_code)]
pub fn split_front_back(body: &str) -> (String, Option<String>) {
    let lines: Vec<&str> = body.lines().collect();
    match lines.iter().position(|l| l.trim() == "---") {
        Some(idx) => (
            lines[..idx].join("\n").trim().to_string(),
            Some(lines[idx + 1..].join("\n").trim().to_string()),
        ),
        None => (body.trim().to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_card_good_gets_one_day() {
        let next = next_card_state(initial_card_state(), Rating::Good);
        assert_eq!(next.interval_days, 1.0);
        assert_eq!(next.repetitions, 1);
    }

    #[test]
    fn second_good_gets_six_days() {
        let s = next_card_state(initial_card_state(), Rating::Good);
        let s = next_card_state(s, Rating::Good);
        assert_eq!(s.interval_days, 6.0);
        assert_eq!(s.repetitions, 2);
    }

    #[test]
    fn again_resets_progress() {
        let s = next_card_state(initial_card_state(), Rating::Good);
        let s = next_card_state(s, Rating::Good);
        let s = next_card_state(s, Rating::Good);
        let s = next_card_state(s, Rating::Again);
        assert_eq!(s.repetitions, 0);
        assert_eq!(s.interval_days, 1.0);
    }

    #[test]
    fn ease_floor_is_1_3() {
        let mut s = initial_card_state();
        for _ in 0..20 {
            s = next_card_state(s, Rating::Again);
        }
        assert!(s.ease >= 1.3);
    }

    #[test]
    fn splits_on_exact_separator_line() {
        let (front, back) = split_front_back("Question\n---\nAnswer");
        assert_eq!(front, "Question");
        assert_eq!(back.as_deref(), Some("Answer"));
    }

    #[test]
    fn no_separator_means_no_back() {
        let (front, back) = split_front_back("Just a front, no answer yet.");
        assert_eq!(front, "Just a front, no answer yet.");
        assert!(back.is_none());
    }
}
