import { describe, expect, it } from "vitest";
import { initialCardState, nextCardState } from "./srs";

describe("nextCardState (SM-2)", () => {
  it("a fresh card rated 'good' gets a 1-day interval and repetitions=1", () => {
    const next = nextCardState(initialCardState(), "good");
    expect(next.intervalDays).toBe(1);
    expect(next.repetitions).toBe(1);
  });

  it("the second consecutive 'good' review gets a 6-day interval", () => {
    let state = nextCardState(initialCardState(), "good");
    state = nextCardState(state, "good");
    expect(state.intervalDays).toBe(6);
    expect(state.repetitions).toBe(2);
  });

  it("the third+ consecutive success multiplies the interval by ease", () => {
    let state = nextCardState(initialCardState(), "good");
    state = nextCardState(state, "good"); // interval=6
    const easeAtThatPoint = state.ease;
    state = nextCardState(state, "good");
    expect(state.intervalDays).toBe(Math.round(6 * easeAtThatPoint));
    expect(state.repetitions).toBe(3);
  });

  it("'again' resets repetitions to 0 and interval to 1 day, regardless of prior progress", () => {
    let state = nextCardState(initialCardState(), "good");
    state = nextCardState(state, "good");
    state = nextCardState(state, "good"); // several successful reviews in
    state = nextCardState(state, "again");
    expect(state.repetitions).toBe(0);
    expect(state.intervalDays).toBe(1);
  });

  it("ease never drops below 1.3 even after repeated 'again'", () => {
    let state = initialCardState();
    for (let i = 0; i < 20; i++) state = nextCardState(state, "again");
    expect(state.ease).toBeGreaterThanOrEqual(1.3);
  });

  it("'easy' increases ease more than 'good', which increases it more than 'hard'", () => {
    const afterHard = nextCardState(initialCardState(), "hard").ease;
    const afterGood = nextCardState(initialCardState(), "good").ease;
    const afterEasy = nextCardState(initialCardState(), "easy").ease;
    expect(afterEasy).toBeGreaterThan(afterGood);
    expect(afterGood).toBeGreaterThan(afterHard);
  });
});
