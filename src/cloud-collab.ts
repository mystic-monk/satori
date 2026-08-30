import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  deriveRoomSecrets,
  decodeContentKey,
  deriveRoomBucketId,
  encrypt,
  decrypt,
  generateSigningKeypair,
  sign,
} from "./crypto";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const REMOTE_ORIGIN = "cloud-remote";

// Outer wire-frame kinds — separate from the MSG_SYNC/MSG_AWARENESS bytes
// above, which live *inside* the encrypted ciphertext and stay opaque to
// the relay. These three bytes are the only thing the relay ever reads in
// the clear:
//   PLAIN    - handshake/reply/presence traffic. Always forwarded to every
//              other peer, exactly like every message was before this file
//              grew role separation. No signature, because none of this is
//              "a new edit" — see the doc.on("update", ...) comment below
//              for why that's the one thing that actually needs gating.
//   UPDATE   - a genuine local content change, broadcast for others to
//              apply. Carries a pubkey + signature over the ciphertext so
//              the relay can verify the sender previously proved editor
//              access, without ever decrypting the payload to check.
//   REGISTER - client-to-relay only, never forwarded to other peers. Proves
//              knowledge of this room's editToken so the relay will accept
//              this session's pubkey as an authorized writer from here on.
const FRAME_PLAIN = 0;
const FRAME_UPDATE = 1;
const FRAME_REGISTER = 2;

export type CloudStatus = "connecting" | "connected" | "disconnected" | "decrypt-failed" | "error";
export type CloudRole = "edit" | "view";

export interface CloudSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: awarenessProtocol.Awareness;
  role: CloudRole;
  destroy: () => void;
}

// One of these two — never both, and never neither. See deriveRoomSecrets'
// doc comment in crypto.ts for why contentKey-alone can't be upgraded into
// editToken: they're independent siblings derived from the same master
// key, not a chain.
export type CloudSecret = { kind: "passphrase"; value: string } | { kind: "contentKey"; value: string };

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;

export async function openCloudCollab(
  room: string,
  secret: CloudSecret,
  relayBase: string,
  onStatus: (s: CloudStatus) => void
): Promise<CloudSession> {
  let contentKey: Uint8Array;
  let editToken: Uint8Array | null = null;
  if (secret.kind === "passphrase") {
    const secrets = await deriveRoomSecrets(secret.value, room);
    contentKey = secrets.contentKey;
    editToken = secrets.editToken;
  } else {
    contentKey = await decodeContentKey(secret.value);
  }
  const role: CloudRole = editToken ? "edit" : "view";
  const signingKeypair = editToken ? await generateSigningKeypair() : null;
  const bucketId = await deriveRoomBucketId(contentKey, room);

  const doc = new Y.Doc();
  const ytext = doc.getText("content");
  const awareness = new awarenessProtocol.Awareness(doc);

  const wsUrl = `${relayBase.replace(/\/$/, "")}/relay/${encodeURIComponent(bucketId)}`;
  let ws: WebSocket;
  let destroyed = false;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  // PLAIN frame: handshake/reply/presence — every peer, view or edit, both
  // sends and accepts these freely. Unchanged in spirit from before this
  // file had any role separation at all.
  function sendPlain(bytes: Uint8Array) {
    if (destroyed || ws.readyState !== WebSocket.OPEN) return;
    encrypt(bytes, contentKey).then((cipher) => {
      if (!destroyed) ws.send(concatBytes(new Uint8Array([FRAME_PLAIN]), cipher));
    });
  }

  // UPDATE frame: a real content change. Only called with a signing
  // keypair in hand (role === "edit") — see the doc.on("update", ...)
  // wiring below, which is the only call site.
  function sendUpdate(bytes: Uint8Array) {
    if (destroyed || ws.readyState !== WebSocket.OPEN || !signingKeypair) return;
    encrypt(bytes, contentKey).then(async (cipher) => {
      if (destroyed) return;
      const signature = await sign(cipher, signingKeypair.privateKey);
      ws.send(concatBytes(new Uint8Array([FRAME_UPDATE]), signingKeypair.publicKey, signature, cipher));
    });
  }

  function sendRegister() {
    if (!signingKeypair || !editToken) return;
    ws.send(concatBytes(new Uint8Array([FRAME_REGISTER]), signingKeypair.publicKey, editToken));
  }

  function scheduleRetry() {
    if (destroyed || retryTimer) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
    retryAttempt++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    onStatus("connecting");
    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      retryAttempt = 0;
      onStatus("connected");
      if (role === "edit") sendRegister();
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeSyncStep1(encoder, doc);
      sendPlain(encoding.toUint8Array(encoder));
    });

    ws.addEventListener("message", async (ev) => {
      const frame = new Uint8Array(ev.data as ArrayBuffer);
      if (frame.length < 1 || (frame[0] !== FRAME_PLAIN && frame[0] !== FRAME_UPDATE)) return;
      // The relay already verified UPDATE frames' signatures before
      // forwarding them (server/relay.ts) — this side only needs the
      // ciphertext either way, PLAIN and UPDATE frames just have that
      // payload at a different offset.
      const ciphertext = frame[0] === FRAME_PLAIN ? frame.slice(1) : frame.slice(1 + 32 + 64);
      let plain: Uint8Array;
      try {
        plain = await decrypt(ciphertext, contentKey);
      } catch {
        // Wrong passphrase/content key, or a blob from a peer using a
        // different key — the relay can't tell those apart, but we can:
        // authentication fails.
        onStatus("decrypt-failed");
        return;
      }
      const decoder = decoding.createDecoder(plain);
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE_ORIGIN);
        // A syncStep2 reply here is "here's the state I already have," not
        // a new edit — sendPlain, not sendUpdate, so view-only peers can
        // still help bootstrap a newly-joined peer even though they can't
        // author new changes themselves.
        if (encoding.length(encoder) > 1) sendPlain(encoding.toUint8Array(encoder));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), REMOTE_ORIGIN);
      }
    });

    ws.addEventListener("close", () => {
      if (destroyed) return;
      onStatus("disconnected");
      scheduleRetry();
    });
    ws.addEventListener("error", () => {
      if (destroyed) return;
      onStatus("error");
      scheduleRetry();
    });
  }

  connect();

  // The one call site that represents "a new local edit happened" — guarded
  // against REMOTE_ORIGIN so applying someone else's incoming change never
  // gets echoed back out as if it were a fresh edit of our own. This is
  // deliberately the only thing sendUpdate (signed, gated) is used for;
  // everything else in this file is protocol/presence traffic sent via
  // sendPlain, unsigned, exactly as before role separation existed.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    sendUpdate(encoding.toUint8Array(encoder));
  });

  awareness.on(
    "update",
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      sendPlain(encoding.toUint8Array(encoder));
    }
  );

  return {
    doc,
    ytext,
    awareness,
    role,
    destroy: () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws.close();
      doc.destroy();
    },
  };
}
