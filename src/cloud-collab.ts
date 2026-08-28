import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { deriveKey, encrypt, decrypt } from "./crypto";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const REMOTE_ORIGIN = "cloud-remote";

export type CloudStatus = "connecting" | "connected" | "disconnected" | "decrypt-failed" | "error";

export interface CloudSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: awarenessProtocol.Awareness;
  destroy: () => void;
}

// Cloud-mode session: same Yjs sync/awareness protocol as local mode
// (server/collab.ts), but every message is encrypted client-side before it
// reaches the relay, which only ever forwards ciphertext (server/relay.ts).
//
// `relayBase` is the ws(s)://host[:port] the relay is reachable at — it
// must be passed in, not derived from location.hostname:3001, because that
// derivation is only ever right in local dev (frontend and API on the same
// host, API hardcoded to 3001). It breaks for: a packaged Tauri build
// (no bundled relay process at all — see the long-term "no sidecar"
// architecture decision), and a production web deploy reverse-proxied
// behind a different port/host. See relayUrlDefault() below for the one
// case where the old derivation is still a reasonable guess.
export async function openCloudCollab(
  room: string,
  passphrase: string,
  relayBase: string,
  onStatus: (s: CloudStatus) => void
): Promise<CloudSession> {
  const key = await deriveKey(passphrase, room);
  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const awareness = new awarenessProtocol.Awareness(doc);

  const wsUrl = `${relayBase.replace(/\/$/, "")}/relay/${encodeURIComponent(room)}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  let destroyed = false;

  function send(bytes: Uint8Array) {
    if (destroyed || ws.readyState !== WebSocket.OPEN) return;
    encrypt(bytes, key).then((cipher) => {
      if (!destroyed) ws.send(cipher);
    });
  }

  ws.addEventListener("open", () => {
    onStatus("connected");
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoding.toUint8Array(encoder));
  });

  ws.addEventListener("message", async (ev) => {
    let plain: Uint8Array;
    try {
      plain = await decrypt(new Uint8Array(ev.data as ArrayBuffer), key);
    } catch {
      // Wrong passphrase, or a blob from a peer using a different key —
      // the relay can't tell those apart, but we can: authentication fails.
      onStatus("decrypt-failed");
      return;
    }
    const decoder = decoding.createDecoder(plain);
    const type = decoding.readVarUint(decoder);
    if (type === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE_ORIGIN);
      if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), REMOTE_ORIGIN);
    }
  });

  ws.addEventListener("close", () => !destroyed && onStatus("disconnected"));
  ws.addEventListener("error", () => !destroyed && onStatus("error"));

  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    send(encoding.toUint8Array(encoder));
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      send(encoding.toUint8Array(encoder));
    }
  );

  return {
    doc,
    ytext,
    awareness,
    destroy: () => {
      destroyed = true;
      ws.close();
      doc.destroy();
    },
  };
}
