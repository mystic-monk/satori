import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { fetchComments, postComment, type Comment } from "./api";
import { getIdentity } from "./identity";
import DisclosureChevron from "./DisclosureChevron";
import { encodeAnchor, resolveAnchorRange, type ResolvedAnchor } from "./yjsAnchor";
import type { CommentRange } from "./Editor";

interface CommentsPanelProps {
  path: string;
  canComment: boolean;
  shareToken?: string | null;
  // Only present when there's a live note open to anchor against — a
  // guest with just a share link viewing a read-only snapshot, say, still
  // gets the flat thread, just never the anchoring UI. See yjsAnchor.ts
  // for why anchoring needs the actual live Y.Text, not just its string.
  ytext?: Y.Text;
  // Set by App.tsx when the "💬 Comment" button in the editor (Editor.tsx,
  // triggered by selecting text) is clicked — this panel takes it from
  // there: opens itself, shows what's about to be commented on, and
  // encodes it into the posted comment.
  pendingAnchor?: { from: number; to: number } | null;
  onPendingAnchorConsumed?: () => void;
  // Reports resolved (live, drift-corrected) ranges back up so App.tsx can
  // hand them to Editor.tsx for the persistent highlight — the highlight
  // is a property of *comments existing*, not of this panel being open,
  // so the range data has to escape this component's own local state.
  onRangesResolved?: (ranges: CommentRange[]) => void;
  onExcerptClick?: (offset: number) => void;
}

// The "comment" share role's actual feature — previously that role
// existed in SharePanel with no comment UI anywhere, so granting it did
// nothing (see the fixed ROLE_LABEL in SharePanel.tsx). Anchored to a
// specific text range via Yjs relative positions (yjsAnchor.ts) when
// created from a selection; a comment created with the panel's own
// compose box (no selection involved) stays a plain note-level comment,
// same as before this existed — anchoring is additive, not required.
export default function CommentsPanel({
  path,
  canComment,
  shareToken,
  ytext,
  pendingAnchor,
  onPendingAnchorConsumed,
  onRangesResolved,
  onExcerptClick,
}: CommentsPanelProps) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (open) fetchComments(path, shareToken).then(setComments);
  }, [path, open, shareToken]);

  // Auto-opens so the person who just clicked "Comment" on a selection
  // actually sees the compose box they're about to type into, rather than
  // it silently going nowhere if the panel happened to be collapsed.
  useEffect(() => {
    if (pendingAnchor) setOpen(true);
  }, [pendingAnchor]);

  // Resolved once per comments-list change (not per render) — cheap
  // (yjsAnchor.ts's decode is just arithmetic against the doc's internal
  // structure, no network/async), but no reason to redo it every render.
  useEffect(() => {
    if (!ytext || !onRangesResolved) return;
    const ranges = comments
      .map((c) => resolveAnchorRange(c.anchorStart, c.anchorEnd, ytext.doc!))
      .filter((r): r is ResolvedAnchor => r !== null)
      .map((r) => ({ from: r.start, to: r.end }));
    onRangesResolved(ranges);
  }, [comments, ytext, onRangesResolved]);

  function excerptFor(c: Comment): string | null {
    if (!ytext || !c.anchorStart || !c.anchorEnd) return null;
    const range = resolveAnchorRange(c.anchorStart, c.anchorEnd, ytext.doc!);
    if (!range) return null;
    const text = ytext.toString().slice(range.start, range.end);
    return text.length > 80 ? text.slice(0, 80) + "…" : text;
  }

  async function onPost() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      const identity = getIdentity();
      const anchorStart = pendingAnchor && ytext ? encodeAnchor(ytext, pendingAnchor.from) : null;
      const anchorEnd = pendingAnchor && ytext ? encodeAnchor(ytext, pendingAnchor.to) : null;
      const comment = await postComment(path, trimmed, identity.id, identity.name, shareToken, anchorStart, anchorEnd);
      setComments((prev) => [...prev, comment]);
      setDraft("");
      onPendingAnchorConsumed?.();
    } finally {
      setPosting(false);
    }
  }

  const pendingExcerpt =
    pendingAnchor && ytext ? ytext.toString().slice(pendingAnchor.from, pendingAnchor.to) : null;

  return (
    <div className="comments-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        <DisclosureChevron open={open} /> Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </button>
      {open && (
        <div className="comments-body">
          <ul className="comments-list">
            {comments.map((c) => {
              const excerpt = excerptFor(c);
              return (
                <li key={c.id}>
                  <div className="comment-meta">
                    <span className="comment-author">{c.authorName}</span>
                    <span className="comment-time">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  {excerpt && (
                    <button
                      className="comment-excerpt"
                      onClick={() => {
                        const range = resolveAnchorRange(c.anchorStart, c.anchorEnd, ytext!.doc!);
                        if (range) onExcerptClick?.(range.start);
                      }}
                      title="Jump to this text"
                    >
                      “{excerpt}”
                    </button>
                  )}
                  <div className="comment-body">{c.body}</div>
                </li>
              );
            })}
            {comments.length === 0 && <li className="comments-empty">No comments yet.</li>}
          </ul>
          {canComment && (
            <div className="comment-compose">
              {pendingExcerpt && (
                <div className="comment-pending-anchor">
                  Commenting on: <span>“{pendingExcerpt}”</span>
                  <button className="comment-pending-anchor-clear" onClick={() => onPendingAnchorConsumed?.()}>
                    ×
                  </button>
                </div>
              )}
              <textarea
                placeholder="Leave a comment…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={posting}
                autoFocus={!!pendingAnchor}
              />
              <button onClick={onPost} disabled={posting || !draft.trim()}>
                Post
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
