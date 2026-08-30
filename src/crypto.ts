// The "sumo" build is required, not the default one — crypto_pwhash
// (Argon2id) is left out of libsodium-wrappers to keep it small.
import sodium from "libsodium-wrappers-sumo";

let readyPromise: Promise<typeof sodium> | null = null;
function getSodium(): Promise<typeof sodium> {
  if (!readyPromise) readyPromise = sodium.ready.then(() => sodium);
  return readyPromise;
}

// Argon2id key derivation (crypto_pwhash) from a shared passphrase. The salt
// is derived deterministically from the room id — salts don't need to be
// secret, only unique per derivation context, and using the (public) room
// id avoids a separate salt-exchange step. The passphrase is the only
// secret; it never leaves the client.
//
// This is the *master* key, not used directly for content anymore — see
// deriveRoomSecrets below. Kept as its own exported function because
// nothing about the Argon2id-from-passphrase step changed; only what
// happens to the result did.
export async function deriveMasterKey(passphrase: string, room: string): Promise<Uint8Array> {
  const s = await getSodium();
  const salt = s.crypto_generichash(s.crypto_pwhash_SALTBYTES, room, null);
  return s.crypto_pwhash(
    s.crypto_kdf_KEYBYTES,
    passphrase,
    salt,
    s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    s.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    s.crypto_pwhash_ALG_DEFAULT
  );
}

export interface RoomSecrets {
  contentKey: Uint8Array; // encrypts/decrypts note content — same role deriveKey's result used to play alone
  editToken: Uint8Array; // proves write eligibility to the relay; never used to encrypt content
}

// contentKey and editToken are siblings derived independently from the same
// master key (crypto_kdf_derive_from_key with different subkey ids) —
// deliberately NOT a chain where one derives from the other. That's what
// makes real role separation possible: a "view" invite can hand someone
// contentKey alone (so they can decrypt/encrypt content, same as everyone
// always could) without handing over anything that lets them compute
// editToken and register as a relay-authorized writer. An "edit" invite
// hands over the passphrase itself, so the recipient derives both locally.
export async function deriveRoomSecrets(passphrase: string, room: string): Promise<RoomSecrets> {
  const s = await getSodium();
  const master = await deriveMasterKey(passphrase, room);
  const context = s.crypto_kdf_CONTEXTBYTES === 8 ? "satorikd" : "";
  return {
    contentKey: s.crypto_kdf_derive_from_key(s.crypto_secretbox_KEYBYTES, 1, context, master),
    editToken: s.crypto_kdf_derive_from_key(32, 2, context, master),
  };
}

// The plain content key alone, base64url-encoded, is what a "view" invite
// link carries — see deriveRoomSecrets' doc comment for why that's safe to
// hand out without also granting write access.
export async function encodeContentKey(contentKey: Uint8Array): Promise<string> {
  const s = await getSodium();
  return s.to_base64(contentKey, s.base64_variants.URLSAFE_NO_PADDING);
}

export async function decodeContentKey(encoded: string): Promise<Uint8Array> {
  const s = await getSodium();
  return s.from_base64(encoded, s.base64_variants.URLSAFE_NO_PADDING);
}

export interface SigningKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

// A fresh, throwaway Ed25519 keypair generated client-side for one cloud
// session — not a persistent user identity (see src/identity.ts for that,
// separate concern). Its only job is proving to the relay "the same client
// that registered as an editor for this room a moment ago sent this
// specific update," so the relay can reject writes from anyone who never
// proved they hold editToken, without ever decrypting anything to do it.
export async function generateSigningKeypair(): Promise<SigningKeypair> {
  const s = await getSodium();
  const kp = s.crypto_sign_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

export async function sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium();
  return s.crypto_sign_detached(message, privateKey);
}

export async function verifySignature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  const s = await getSodium();
  try {
    return s.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

// The relay routes connections into buckets by this id, not the bare room
// name string — two unrelated rooms that happen to share a human-typed name
// (plausible: both default to a note path like "meeting-notes.md") would
// otherwise get mixed into the same relay-side connection set and ACL,
// which leaks "someone else is active here" metadata even though content
// stays undecipherable to them either way. Deterministic and derivable by
// anyone who already has contentKey (everyone in the room, view or edit),
// so it needs no separate exchange — but not derivable from the room name
// alone, so an outsider who doesn't know the secret can't compute it either.
export async function deriveRoomBucketId(contentKey: Uint8Array, room: string): Promise<string> {
  const s = await getSodium();
  const tag = s.crypto_generichash(16, room, contentKey);
  return s.to_hex(tag);
}

// XSalsa20-Poly1305 (libsodium secretbox) — authenticated, vetted, not
// hand-rolled. Output is nonce || ciphertext so decrypt() is self-contained.
export async function encrypt(plain: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const cipher = s.crypto_secretbox_easy(plain, nonce, key);
  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce, 0);
  out.set(cipher, nonce.length);
  return out;
}

// Throws if the ciphertext doesn't authenticate under `key` — e.g. wrong
// passphrase, or a foreign/tampered blob from the (untrusted) relay.
export async function decrypt(data: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const s = await getSodium();
  const nonceLen = s.crypto_secretbox_NONCEBYTES;
  const nonce = data.slice(0, nonceLen);
  const cipher = data.slice(nonceLen);
  return s.crypto_secretbox_open_easy(cipher, nonce, key);
}
