import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import fs from "node:fs";
import path from "node:path";
import { readNoteRaw, writeNoteRaw } from "./vault.js";
import { upsertNoteIndex } from "./db.js";

// Local-mode real-time collaboration. This server runs on the user's own
// machine (or LAN) — it is not a cloud vendor — so it is allowed to decode
// Yjs updates and see plaintext, same trust boundary as the REST API.
// Cloud mode (relay.ts) is different: that server must never decode anything.

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

const CRDT_DIR = path.resolve(process.cwd(), ".pkm", "crdt");
fs.mkdirSync(CRDT_DIR, { recursive: true });

function crdtStatePath(notePath: string): string {
  return path.join(CRDT_DIR, `${notePath.replace(/\//g, "__")}.ybin`);
}

class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Map<WebSocket, Set<number>>(); // ws -> awareness clientIDs it controls
  saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public notePath: string) {
    const statePath = crdtStatePath(notePath);
    if (fs.existsSync(statePath)) {
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
          const ids = this.conns.get(origin);
          if (ids) for (const id of added.concat(updated)) ids.add(id);
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

  addConn(ws: WebSocket) {
    this.conns.set(ws, new Set());

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
    const ids = this.conns.get(ws);
    this.conns.delete(ws);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ids), null);
    }
    if (this.conns.size === 0) {
      this.persist();
      rooms.delete(this.notePath);
    }
  }

  handleMessage(ws: WebSocket, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
    } else if (type === MSG_AWARENESS) {
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
    const notePath = decodeURIComponent(req.url!.replace("/collab/", ""));
    const room = getRoom(notePath);
    room.addConn(ws);

    ws.on("message", (data: Buffer) => room.handleMessage(ws, new Uint8Array(data)));
    ws.on("close", () => room.removeConn(ws));
  });

  console.log("local collab (Yjs) server attached at ws://<host>/collab/<note-path>");
}
