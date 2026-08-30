import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import sodium from "libsodium-wrappers-sumo";

// Cloud-mode relay. Still never decrypts anything — no Yjs, no content
// decoding, no key material for the actual note text. What it CAN do is
// verify a signature over ciphertext it can't read, which is enough to
// gate *who's allowed to broadcast a new update* without needing to know
// what that update says. See src/crypto.ts's deriveRoomSecrets doc comment
// and src/cloud-collab.ts's frame-kind comments for the full design; this
// file is the enforcement half of it.
//
// Same "sumo" build server/auth.ts already uses (crypto_pwhash isn't in
// the default libsodium-wrappers build) — here only for crypto_sign_verify.
let readyPromise: Promise<typeof sodium> | null = null;
function getSodium(): Promise<typeof sodium> {
  if (!readyPromise) readyPromise = sodium.ready.then(() => sodium);
  return readyPromise;
}

const FRAME_PLAIN = 0;
const FRAME_UPDATE = 1;
const FRAME_REGISTER = 2;

const PUBKEY_LEN = 32;
const SIG_LEN = 64;
const EDIT_TOKEN_LEN = 32;

interface Bucket {
  peers: Set<WebSocket>;
  // Set on whichever REGISTER frame arrives first for this bucket — every
  // later REGISTER must present the same editToken (hashed here, so the
  // raw token itself isn't held any longer than the one comparison needs)
  // to be accepted. Trust-on-first-use is enough here: the relay holds no
  // state across restarts anyway, and the first registrant already had to
  // know editToken, which only someone with the room's passphrase can
  // derive (see deriveRoomSecrets) — this isn't verifying "the true owner
  // connected first," just "every registrant in this session agrees on the
  // same secret," which is exactly what's needed to keep the editor set
  // consistent for as long as the bucket lives.
  editTokenHash: Buffer | null;
  editorPubkeys: Set<string>; // hex-encoded
}

const buckets = new Map<string, Bucket>();

function getBucket(id: string): Bucket {
  let bucket = buckets.get(id);
  if (!bucket) {
    bucket = { peers: new Set(), editTokenHash: null, editorPubkeys: new Set() };
    buckets.set(id, bucket);
  }
  return bucket;
}

function broadcast(bucket: Bucket, from: WebSocket, data: RawData, isBinary: boolean) {
  for (const peer of bucket.peers) {
    if (peer !== from && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
  }
}

async function handleRegister(bucket: Bucket, frame: Buffer): Promise<void> {
  if (frame.length !== 1 + PUBKEY_LEN + EDIT_TOKEN_LEN) return;
  const pubkey = frame.subarray(1, 1 + PUBKEY_LEN);
  const editToken = frame.subarray(1 + PUBKEY_LEN);
  const s = await getSodium();
  const tokenHash = Buffer.from(s.crypto_generichash(32, editToken, null));

  if (!bucket.editTokenHash) {
    bucket.editTokenHash = tokenHash;
  } else if (
    bucket.editTokenHash.length !== tokenHash.length ||
    !timingSafeEqual(bucket.editTokenHash, tokenHash)
  ) {
    return; // presented a different secret than whoever registered first — not an editor
  }
  bucket.editorPubkeys.add(pubkey.toString("hex"));
}

async function verifyUpdate(bucket: Bucket, frame: Buffer): Promise<boolean> {
  if (frame.length < 1 + PUBKEY_LEN + SIG_LEN) return false;
  const pubkey = frame.subarray(1, 1 + PUBKEY_LEN);
  if (!bucket.editorPubkeys.has(pubkey.toString("hex"))) return false;
  const signature = frame.subarray(1 + PUBKEY_LEN, 1 + PUBKEY_LEN + SIG_LEN);
  const ciphertext = frame.subarray(1 + PUBKEY_LEN + SIG_LEN);
  const s = await getSodium();
  try {
    return s.crypto_sign_verify_detached(signature, ciphertext, pubkey);
  } catch {
    return false;
  }
}

export function setupRelayServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/relay/")) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req) => {
    // Despite the name, this is now a bucket id the client derives from
    // (room name, content key) together — see deriveRoomBucketId in
    // src/crypto.ts — not a bare human-typed room string, so two unrelated
    // rooms that happen to share a name never share a bucket.
    const bucketId = decodeURIComponent(req.url!.replace("/relay/", ""));
    const bucket = getBucket(bucketId);
    bucket.peers.add(ws);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!isBinary || !Buffer.isBuffer(data) || data.length < 1) return;
      const kind = data[0];
      if (kind === FRAME_PLAIN) {
        broadcast(bucket, ws, data, isBinary);
      } else if (kind === FRAME_UPDATE) {
        verifyUpdate(bucket, data).then((ok) => {
          if (ok) broadcast(bucket, ws, data, isBinary);
          // Silently dropped otherwise — no error sent back. A peer without
          // write access finding out *why* their update didn't land isn't
          // information the relay needs to hand a potentially malicious
          // client; the client-side UI already prevents this for a
          // cooperating one (view-mode notes are read-only in the editor).
        });
      } else if (kind === FRAME_REGISTER) {
        handleRegister(bucket, data);
        // Never broadcast — this is a client-to-relay control message only.
      }
    });

    ws.on("close", () => {
      bucket.peers.delete(ws);
      if (bucket.peers.size === 0) buckets.delete(bucketId);
    });
  });

  console.log("cloud relay (opaque blobs only, signature-gated writes) attached at ws://<host>/relay/<bucket>");
}
