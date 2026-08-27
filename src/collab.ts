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

// Replaces a Y.Text's content with newValue by diffing against its current
// string down to a common prefix/suffix and touching only the changed
// middle span — so a full-text rewrite (e.g. the properties panel
// regenerating the frontmatter block) doesn't clobber a concurrent edit
// elsewhere in the same note the way delete-everything-then-insert would.
export function applyTextDiff(ytext: Y.Text, newValue: string, origin: unknown): void {
  const oldValue = ytext.toString();
  if (oldValue === newValue) return;

  let start = 0;
  while (start < oldValue.length && start < newValue.length && oldValue[start] === newValue[start]) {
    start++;
  }
  let oldEnd = oldValue.length;
  let newEnd = newValue.length;
  while (oldEnd > start && newEnd > start && oldValue[oldEnd - 1] === newValue[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  ytext.doc!.transact(() => {
    if (oldEnd > start) ytext.delete(start, oldEnd - start);
    if (newEnd > start) ytext.insert(start, newValue.slice(start, newEnd));
  }, origin);
}
