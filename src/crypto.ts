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
export async function deriveKey(passphrase: string, room: string): Promise<Uint8Array> {
  const s = await getSodium();
  const salt = s.crypto_generichash(s.crypto_pwhash_SALTBYTES, room, null);
  return s.crypto_pwhash(
    s.crypto_secretbox_KEYBYTES,
    passphrase,
    salt,
    s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    s.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    s.crypto_pwhash_ALG_DEFAULT
  );
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
