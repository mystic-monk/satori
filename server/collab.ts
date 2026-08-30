import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import fs from "node:fs";
import path from "node:path";
import { readNoteRaw, writeNoteRaw, getNoteMtime } from "./vault.js";
import { upsertNoteIndex, resolveShareRole, logHistory, type ShareRole } from "./db.js";

// Local-mode real-time collaboration. This server runs on the user's own
// machine (or LAN) — it is not a cloud vendor — so it is allowed to decode
// Yjs updates and see plaintext, same trust boundary as the REST API.
// Cloud mode (relay.ts) is different: that server must never decode anything.

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

// Deliberately NOT under .pkm/ (the disposable search-cache directory the
// app itself tells users, via the Reindex button and the tutorial note, is
// safe to delete any time). Deleting this file while a client still holds
// state synced from before the deletion is genuinely unsafe: the next
// connection reseeds a *new*, causally-independent Yjs history from the
// .md file, and when a stale client (e.g. one that never cleanly
// disconnected) reconnects, Yjs correctly merges both "insert full text"
// operations as non-conflicting — silently duplicating the note's content.
// Found exactly this happening to a real file during testing; see the
// commit that introduced this comment.
const CRDT_DIR = path.resolve(process.cwd(), ".pkm-state", "crdt");
fs.mkdirSync(CRDT_DIR, { recursive: true });

function crdtStatePath(notePath: string): string {
  return path.join(CRDT_DIR, `${notePath.replace(/\//g, "__")}.ybin`);
}

interface ConnInfo {
  ids: Set<number>; // awareness clientIDs this connection controls
  role: ShareRole | "owner";
  name: string;
  id: string | null; // stable per-person identity id (src/identity.ts)
}

export class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Map<WebSocket, ConnInfo>();
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Keyed by identity id (not name) so a rename mid-session still
  // attributes to the same history entry — falls back to a name-derived
  // key only for a connection with no id at all (an old cached client
  // bundle, or a guest whose browser somehow skipped src/identity.ts).
  pendingAuthors = new Map<string, string>();

  constructor(public notePath: string) {
    const statePath = crdtStatePath(notePath);
    // A .ybin snapshot is normally authoritative — it can hold edits made
    // through this collab session that were debounced and not yet flushed
    // to the .md file. But if the .md file's mtime is *newer* than the
    // snapshot, something outside the collab system (a direct edit, a git
    // checkout, a sync from another device) touched the file after the
    // last collab session for this note ended. Trusting the stale
    // snapshot in that case would silently revert that change the moment
    // anyone next opens the note here — found this actually happening to
    // a real file (see the CRDT_DIR comment above for the sibling bug).
    // Reseed a fresh, causally-independent doc from the file instead.
    const ybinExists = fs.existsSync(statePath);
    const ybinMtime = ybinExists ? fs.statSync(statePath).mtimeMs : null;
    const mdMtime = getNoteMtime(notePath);
    const trustYbin = ybinExists && !(mdMtime !== null && ybinMtime !== null && mdMtime > ybinMtime);

    if (trustYbin) {
      Y.applyUpdate(this.doc, fs.readFileSync(statePath));
    } else {
      let raw = "";
      try {
        raw = readNoteRaw(notePath);
      } catch {
        // note doesn't exist on disk yet — start empty
      }
      if (raw) this.doc.getText("content").insert(0, raw);
    }

    this.doc.on("update", (update: Uint8Array, origin: WebSocket | null) => {
      this.broadcastUpdate(update, origin);
      this.scheduleSave();
    });

    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: WebSocket | null) => {
        const changed = added.concat(updated, removed);
        this.broadcastAwareness(changed);
        if (origin instanceof WebSocket) {
          const info = this.conns.get(origin);
          if (info) for (const id of added.concat(updated)) info.ids.add(id);
        }
      }
    );
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persist(), 500);
  }

  persist() {
    fs.writeFileSync(crdtStatePath(this.notePath), Y.encodeStateAsUpdate(this.doc));
    // The Yjs binary state is a sync cache. The markdown file stays the
    // human-readable, portable source of truth — same principle as the
    // SQLite index: rebuildable, never authoritative on its own.
    const text = this.doc.getText("content").toString();
    writeNoteRaw(this.notePath, text);
    upsertNoteIndex(this.notePath);
    if (this.pendingAuthors.size > 0) {
      logHistory(
        this.notePath,
        Array.from(this.pendingAuthors, ([id, name]) => ({ id: id.startsWith("name:") ? null : id, name }))
      );
      this.pendingAuthors.clear();
    }
  }

  broadcastUpdate(update: Uint8Array, origin: WebSocket | null) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const buf = encoding.toUint8Array(encoder);
    for (const conn of this.conns.keys()) {
      if (conn !== origin && conn.readyState === WebSocket.OPEN) conn.send(buf);
    }
  }

  broadcastAwareness(clientIds: number[]) {
    if (clientIds.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds));
    const buf = encoding.toUint8Array(encoder);
    for (const conn of this.conns.keys()) if (conn.readyState === WebSocket.OPEN) conn.send(buf);
  }

  addConn(ws: WebSocket, role: ShareRole | "owner", name: string, id: string | null) {
    this.conns.set(ws, { ids: new Set(), role, name, id });

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())));
      ws.send(encoding.toUint8Array(enc));
    }
  }

  removeConn(ws: WebSocket) {
    const info = this.conns.get(ws);
    this.conns.delete(ws);
    if (info && info.ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(info.ids), null);
    }
    if (this.conns.size === 0) {
      this.persist();
      rooms.delete(this.notePath);
    }
  }

  // "view"/"comment" connections can still read (sync step 1 -> step 2 is a
  // pure function of server state, safe to answer) but any message that
  // would mutate the doc (sync step 2 or update, both of which flow into
  // Y.applyUpdate) is dropped before it ever reaches the document. This is
  // real server-side enforcement — not a client-side UI restriction the
  // client could just ignore — because this server already has plaintext
  // access to the note (see the file header). A malicious/modified client
  // gains nothing by skipping the read-only UI: the server won't apply its
  // writes regardless of what it sends.
  handleMessage(ws: WebSocket, data: Uint8Array) {
    const info = this.conns.get(ws);
    const readOnly = info?.role === "view" || info?.role === "comment";
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);

    if (type === MSG_SYNC) {
      if (readOnly) {
        const subDecoder = decoding.clone(decoder);
        const subtype = decoding.readVarUint(subDecoder);
        if (subtype !== 0 /* messageYjsSyncStep1 */) return; // drop step2/update
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep2(encoder, this.doc, decoding.readVarUint8Array(subDecoder));
        ws.send(encoding.toUint8Array(encoder));
        return;
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      if (info) this.pendingAuthors.set(info.id ?? `name:${info.name}`, info.name);
    } else if (type === MSG_AWARENESS) {
      // Presence (cursor position, display name) isn't content — fine for
      // read-only connections to broadcast.
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws);
    }
  }
}

const rooms = new Map<string, Room>();

function getRoom(notePath: string): Room {
  let room = rooms.get(notePath);
  if (!room) {
    room = new Room(notePath);
    rooms.set(notePath, room);
  }
  return room;
}

// Called when a note is deleted via the REST API so a stray collab session
// can't resurrect the file by materializing a late CRDT update after the
// fact. Best-effort: closes live connections and drops the persisted CRDT
// state; genuinely concurrent edit-during-delete races are out of scope.
export function closeRoom(notePath: string) {
  const room = rooms.get(notePath);
  if (room) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    for (const conn of room.conns.keys()) conn.close();
    rooms.delete(notePath);
  }
  const statePath = crdtStatePath(notePath);
  if (fs.existsSync(statePath)) fs.rmSync(statePath);
}

export function setupCollabServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/collab/")) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url!, "http://internal");
    const notePath = decodeURIComponent(url.pathname.replace("/collab/", ""));
    const token = url.searchParams.get("token");
    const name = url.searchParams.get("name")?.trim() || "Anonymous";
    const id = url.searchParams.get("id")?.trim() || null;
    const role = resolveShareRole(notePath, token);
    if (role === "denied") {
      ws.close(4403, "invalid or revoked share token");
      return;
    }

    const room = getRoom(notePath);
    room.addConn(ws, role, name, id);

    ws.on("message", (data: Buffer) => room.handleMessage(ws, new Uint8Array(data)));
    ws.on("close", () => room.removeConn(ws));
  });

  console.log("local collab (Yjs) server attached at ws://<host>/collab/<note-path>");
}
