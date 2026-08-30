import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import * as awarenessProtocol from "y-protocols/awareness";
import { writeNoteApi } from "./api";

// One shape covers both deployment modes so the rest of the app (Editor,
// App.tsx's status wiring, the cloud-sync doc bridge) doesn't need to care
// which one it got. provider is null in Tauri mode: there's no local
// WebSocket relay to report connection status for, since Tauri mode
// persists straight to the Rust backend instead of through a synced room —
// see openTauriLocalSession below for why.
export interface CollabHandle {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: awarenessProtocol.Awareness;
  provider: WebsocketProvider | null;
  // skipFlush: true means "this note is about to be deleted, don't write
  // it back to disk" — see openTauriLocalSession's flush-on-destroy below
  // for why this matters. Always safe to call more than once; only the
  // first call has any effect.
  destroy: (skipFlush?: boolean) => void;
}

export interface LocalCollabOptions {
  token?: string | null; // a share token — see server/collab.ts's role enforcement
  name?: string; // display name, used for presence and change history
  id?: string; // stable per-person identity id (src/identity.ts) — see server/collab.ts's pendingAuthors
  onDenied?: () => void; // called if the server rejects the token (WS close code 4403)
}

// Local-mode session: talks to our own local collab relay (server/collab.ts)
// over ws://localhost:3001/collab/<note-path>. Real-time, unencrypted — fine
// because the relay is the user's own machine, same trust boundary as the
// REST API. Used by the browser/Node deployment.
export function openLocalCollab(notePath: string, opts: LocalCollabOptions = {}): CollabHandle {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:3001`;
  const params: Record<string, string> = { name: opts.name || "Anonymous" };
  if (opts.token) params.token = opts.token;
  if (opts.id) params.id = opts.id;
  const provider = new WebsocketProvider(wsUrl, `collab/${notePath}`, doc, { connect: true, params });
  // An invalid/revoked token gets the connection closed with 4403 by the
  // server (server/collab.ts) rather than accepted read-only — without this,
  // y-websocket's default auto-reconnect would just retry the same rejected
  // token forever, leaving the UI stuck on "connecting…".
  provider.on("connection-close", (event: CloseEvent | null) => {
    if (event?.code === 4403) {
      provider.shouldConnect = false;
      provider.disconnect();
      opts.onDenied?.();
    }
  });
  let destroyed = false;
  return {
    doc,
    ytext,
    awareness: provider.awareness,
    provider,
    // skipFlush is a no-op here — this session never writes anything on
    // its own close (server/collab.ts's Room persists on its own schedule,
    // and closeRoom() there already cancels it before a delete responds).
    // Accepted anyway so callers don't need an "if Tauri" branch just to
    // pass the flag correctly.
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      provider.destroy();
      doc.destroy();
    },
  };
}

// Tauri-mode session: no local collab server exists yet (server/collab.ts's
// Yjs sync hasn't been ported to Rust — it would need the yrs crate plus an
// embedded WebSocket server, real separate work). So this doesn't sync
// anywhere; it's a single local peer whose edits debounce-persist straight
// to the Rust backend via the write_note command. Still a real Y.Doc (not a
// plain string) so Editor.tsx's yCollab binding, and the cloud-sync doc
// bridge in App.tsx, work completely unchanged — cloud sync still works in
// Tauri mode even without local real-time collab.
export function openTauriLocalSession(
  notePath: string,
  initialRaw: string,
  author: { id: string; name: string }
): CollabHandle {
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  if (initialRaw) ytext.insert(0, initialRaw);
  const awareness = new awarenessProtocol.Awareness(doc);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === "tauri-seed") return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      writeNoteApi(notePath, ytext.toString(), author);
    }, 400);
  };
  doc.on("update", onUpdate);

  let destroyed = false;
  return {
    doc,
    ytext,
    awareness,
    provider: null,
    // skipFlush=true is how confirmDelete() (App.tsx) avoids a real race:
    // it tears the session down through here directly, then deletes the
    // file. Without this, the normal flush-on-close below would write the
    // file straight back to disk moments after delete_note removed it —
    // React's setActivePath(null) only *schedules* this same cleanup via
    // the effect it's attached to, which isn't guaranteed to run before
    // the delete request that follows it, so relying on that path alone
    // left deletion racing its own debounced autosave.
    destroy: (skipFlush = false) => {
      if (destroyed) return;
      destroyed = true;
      doc.off("update", onUpdate);
      if (saveTimer) {
        clearTimeout(saveTimer);
        if (!skipFlush) writeNoteApi(notePath, ytext.toString(), author); // flush on close, don't lose the last debounce window
      }
      awareness.destroy();
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
