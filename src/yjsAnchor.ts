import * as Y from "yjs";

// Anchors a comment to a text range using Yjs's own relative-position
// primitive instead of raw character offsets — the whole point of a CRDT
// is that content shifts around as people edit, and a plain offset pair
// would silently point at the wrong text the moment anyone edits earlier
// in the document. A relative position is defined relative to a specific
// character's identity in the document, not its numeric index, so it
// tracks the *same text* correctly even after concurrent edits elsewhere.
//
// Encoded as base64 for transport/storage — the server only ever stores
// and returns this string, never decodes it (see server/db.ts's comments
// table doc comment). Decoding only makes sense against a live Y.Doc,
// which only a client has.

export function encodeAnchor(ytext: Y.Text, offset: number): string {
  const relPos = Y.createRelativePositionFromTypeIndex(ytext, offset);
  const bytes = Y.encodeRelativePosition(relPos);
  return btoa(String.fromCharCode(...bytes));
}

// Returns null if the anchor can no longer be resolved — e.g. the anchored
// text was deleted entirely since the comment was made. Callers should
// treat that the same as an unanchored comment (still show the comment,
// just without the excerpt/highlight), not as an error.
export function decodeAnchor(encoded: string, doc: Y.Doc): number | null {
  try {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const relPos = Y.decodeRelativePosition(bytes);
    const absPos = Y.createAbsolutePositionFromRelativePosition(relPos, doc);
    return absPos ? absPos.index : null;
  } catch {
    return null; // malformed/foreign bytes — treat as unresolvable, not a crash
  }
}

export interface ResolvedAnchor {
  start: number;
  end: number;
}

// Both ends resolved together — a comment with only one end resolvable
// (the other end's text was deleted) can't highlight a coherent range, so
// this is all-or-nothing rather than clamping to a guessed length.
export function resolveAnchorRange(anchorStart: string | null, anchorEnd: string | null, doc: Y.Doc): ResolvedAnchor | null {
  if (!anchorStart || !anchorEnd) return null;
  const start = decodeAnchor(anchorStart, doc);
  const end = decodeAnchor(anchorEnd, doc);
  if (start == null || end == null || start >= end) return null;
  return { start, end };
}
