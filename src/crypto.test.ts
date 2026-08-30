import { describe, expect, it } from "vitest";
import {
  deriveRoomSecrets,
  deriveMasterKey,
  encodeContentKey,
  decodeContentKey,
  generateSigningKeypair,
  sign,
  verifySignature,
  deriveRoomBucketId,
  encrypt,
  decrypt,
} from "./crypto";

// Regression + design-verification coverage for the cloud-mode role
// separation redesign: contentKey and editToken must be genuinely
// independent siblings (both derived from the same master key, neither
// derivable from the other) — that's the property that lets a "view"
// invite hand out contentKey alone without also handing out anything that
// lets the recipient compute editToken and register as a writer with the
// relay. See deriveRoomSecrets' doc comment for the full reasoning.
describe("deriveRoomSecrets", () => {
  it("produces two different 32-byte secrets from one passphrase", async () => {
    const { contentKey, editToken } = await deriveRoomSecrets("correct horse battery staple", "note.md");
    expect(contentKey.length).toBe(32);
    expect(editToken.length).toBe(32);
    expect(Buffer.from(contentKey).toString("hex")).not.toBe(Buffer.from(editToken).toString("hex"));
  });

  it("is fully deterministic — same passphrase + room always derives the same secrets", async () => {
    const first = await deriveRoomSecrets("passphrase", "room-a");
    const second = await deriveRoomSecrets("passphrase", "room-a");
    expect(Buffer.from(first.contentKey).toString("hex")).toBe(Buffer.from(second.contentKey).toString("hex"));
    expect(Buffer.from(first.editToken).toString("hex")).toBe(Buffer.from(second.editToken).toString("hex"));
  });

  it("a different passphrase produces entirely different secrets", async () => {
    const a = await deriveRoomSecrets("passphrase-one", "room");
    const b = await deriveRoomSecrets("passphrase-two", "room");
    expect(Buffer.from(a.contentKey).toString("hex")).not.toBe(Buffer.from(b.contentKey).toString("hex"));
    expect(Buffer.from(a.editToken).toString("hex")).not.toBe(Buffer.from(b.editToken).toString("hex"));
  });

  it("a different room produces entirely different secrets for the same passphrase", async () => {
    const a = await deriveRoomSecrets("same passphrase", "room-a");
    const b = await deriveRoomSecrets("same passphrase", "room-b");
    expect(Buffer.from(a.contentKey).toString("hex")).not.toBe(Buffer.from(b.contentKey).toString("hex"));
  });

  it("the underlying master key is not equal to either derived secret", async () => {
    const master = await deriveMasterKey("passphrase", "room");
    const { contentKey, editToken } = await deriveRoomSecrets("passphrase", "room");
    expect(Buffer.from(master).toString("hex")).not.toBe(Buffer.from(contentKey).toString("hex"));
    expect(Buffer.from(master).toString("hex")).not.toBe(Buffer.from(editToken).toString("hex"));
  });
});

describe("content key encode/decode roundtrip", () => {
  it("round-trips a real derived content key", async () => {
    const { contentKey } = await deriveRoomSecrets("passphrase", "room");
    const encoded = await encodeContentKey(contentKey);
    const decoded = await decodeContentKey(encoded);
    expect(Buffer.from(decoded).toString("hex")).toBe(Buffer.from(contentKey).toString("hex"));
  });

  it("a view-only recipient with only the encoded content key can decrypt what an editor encrypted", async () => {
    const { contentKey } = await deriveRoomSecrets("shared secret", "note.md");
    const cipher = await encrypt(new TextEncoder().encode("hello from an editor"), contentKey);

    const viewerKey = await decodeContentKey(await encodeContentKey(contentKey));
    const plain = await decrypt(cipher, viewerKey);
    expect(new TextDecoder().decode(plain)).toBe("hello from an editor");
  });
});

describe("signing", () => {
  it("verifies a signature made with the matching private key", async () => {
    const kp = await generateSigningKeypair();
    const message = new TextEncoder().encode("an update");
    const signature = await sign(message, kp.privateKey);
    expect(await verifySignature(message, signature, kp.publicKey)).toBe(true);
  });

  it("rejects a signature checked against the wrong public key", async () => {
    const kp = await generateSigningKeypair();
    const other = await generateSigningKeypair();
    const message = new TextEncoder().encode("an update");
    const signature = await sign(message, kp.privateKey);
    expect(await verifySignature(message, signature, other.publicKey)).toBe(false);
  });

  it("rejects a signature over a message that was tampered with after signing", async () => {
    const kp = await generateSigningKeypair();
    const signature = await sign(new TextEncoder().encode("original"), kp.privateKey);
    expect(await verifySignature(new TextEncoder().encode("tampered"), signature, kp.publicKey)).toBe(false);
  });

  it("never throws on garbage input — verifySignature returns false instead", async () => {
    const kp = await generateSigningKeypair();
    const garbageSig = new Uint8Array(64).fill(9);
    await expect(verifySignature(new TextEncoder().encode("x"), garbageSig, kp.publicKey)).resolves.toBe(false);
  });
});

describe("deriveRoomBucketId", () => {
  it("is deterministic for the same room + content key", async () => {
    const { contentKey } = await deriveRoomSecrets("passphrase", "room");
    const a = await deriveRoomBucketId(contentKey, "room");
    const b = await deriveRoomBucketId(contentKey, "room");
    expect(a).toBe(b);
  });

  it("two teams who pick the same room name but different passphrases land in different buckets", async () => {
    const teamA = await deriveRoomSecrets("team-a-secret", "meeting-notes.md");
    const teamB = await deriveRoomSecrets("team-b-secret", "meeting-notes.md");
    const bucketA = await deriveRoomBucketId(teamA.contentKey, "meeting-notes.md");
    const bucketB = await deriveRoomBucketId(teamB.contentKey, "meeting-notes.md");
    expect(bucketA).not.toBe(bucketB);
  });
});
