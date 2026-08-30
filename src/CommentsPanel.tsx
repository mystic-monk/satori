import { useEffect, useState } from "react";
import { fetchComments, postComment, type Comment } from "./api";
import { getIdentity } from "./identity";
import DisclosureChevron from "./DisclosureChevron";

interface CommentsPanelProps {
  path: string;
  canComment: boolean;
  shareToken?: string | null;
}

// The "comment" share role's actual feature — previously that role
// existed in SharePanel with no comment UI anywhere, so granting it did
// nothing (see the fixed ROLE_LABEL in SharePanel.tsx). A flat per-note
// thread, not anchored to a text range or line — CRDT-safe range tracking
// across concurrent edits is real scope beyond a first pass, and a flat
// thread already covers "leave feedback on this note" without it.
export default function CommentsPanel({ path, canComment, shareToken }: CommentsPanelProps) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (open) fetchComments(path, shareToken).then(setComments);
  }, [path, open, shareToken]);

  async function onPost() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setPosting(true);
    try {
      const identity = getIdentity();
      const comment = await postComment(path, trimmed, identity.id, identity.name, shareToken);
      setComments((prev) => [...prev, comment]);
      setDraft("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="comments-panel">
      <button className="properties-header" onClick={() => setOpen((o) => !o)}>
        <DisclosureChevron open={open} /> Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </button>
      {open && (
        <div className="comments-body">
          <ul className="comments-list">
            {comments.map((c) => (
              <li key={c.id}>
                <div className="comment-meta">
                  <span className="comment-author">{c.authorName}</span>
                  <span className="comment-time">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div className="comment-body">{c.body}</div>
              </li>
            ))}
            {comments.length === 0 && <li className="comments-empty">No comments yet.</li>}
          </ul>
          {canComment && (
            <div className="comment-compose">
              <textarea
                placeholder="Leave a comment…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={posting}
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
