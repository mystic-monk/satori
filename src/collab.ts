import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

export interface CollabSession {
  doc: Y.Doc;
  ytext: Y.Text;
  provider: WebsocketProvider;
  destroy: () => void;
}

// Local-mode session: talks to our own local collab relay (server/collab.ts)
// over ws://localhost:3001/collab/<note-path>. Real-time, unencrypted — fine
// because the relay is the user's own machine, same trust boundary as the
// REST API.
export function openLocalCollab(notePath: string): CollabSession {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:3001`;
  const provider = new WebsocketProvider(wsUrl, `collab/${notePath}`, doc, { connect: true });
  return {
    doc,
    ytext,
    provider,
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}

// Binds a <textarea> to a Y.Text two-way: local keystrokes become Yjs ops,
// remote ops update the textarea in place. Cursor position is preserved by
// diffing old vs new value down to a common prefix/suffix so only the
// changed middle span is touched.
export function bindTextareaToYText(
  textarea: HTMLTextAreaElement,
  ytext: Y.Text,
  origin: unknown
): () => void {
  let applyingRemote = false;

  textarea.value = ytext.toString();

  const onInput = () => {
    if (applyingRemote) return;
    const oldValue = ytext.toString();
    const newValue = textarea.value;
    if (oldValue === newValue) return;

    let start = 0;
    while (
      start < oldValue.length &&
      start < newValue.length &&
      oldValue[start] === newValue[start]
    ) {
      start++;
    }
    let oldEnd = oldValue.length;
    let newEnd = newValue.length;
    while (
      oldEnd > start &&
      newEnd > start &&
      oldValue[oldEnd - 1] === newValue[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    ytext.doc!.transact(() => {
      if (oldEnd > start) ytext.delete(start, oldEnd - start);
      if (newEnd > start) ytext.insert(start, newValue.slice(start, newEnd));
    }, origin);
  };

  const onYTextChange = () => {
    const newValue = ytext.toString();
    if (textarea.value === newValue) return;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    applyingRemote = true;
    textarea.value = newValue;
    // Best-effort cursor preservation: clamp the previous offsets into the
    // new (possibly shorter/longer) text rather than resetting to 0.
    textarea.selectionStart = Math.min(selStart, newValue.length);
    textarea.selectionEnd = Math.min(selEnd, newValue.length);
    applyingRemote = false;
  };

  textarea.addEventListener("input", onInput);
  ytext.observe(onYTextChange);

  return () => {
    textarea.removeEventListener("input", onInput);
    ytext.unobserve(onYTextChange);
  };
}
