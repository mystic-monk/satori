import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { setupRelayServer } from "./relay.js";
import { generateSigningKeypair, sign } from "../src/crypto.js";

// Real HTTP + WebSocket server on an ephemeral port, exercised with real
// client connections — the same "verify against the real thing" approach
// this project uses for live browser/network tests, applied here because
// relay.ts's actual job (accept/reject a binary frame based on a signature
// check) can't be meaningfully verified by calling its functions directly;
// the behavior IS the wire protocol.
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer();
  setupRelayServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

function connect(bucket: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/relay/${bucket}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 400): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(data as Buffer);
    });
  });
}

function settle(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FRAME_PLAIN = 0;
const FRAME_UPDATE = 1;
const FRAME_REGISTER = 2;

function frame(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

const enc = (s: string) => new TextEncoder().encode(s);
const uniqueBucket = (label: string) => `${label}-${Math.random().toString(36).slice(2)}`;

describe("relay: PLAIN frames (handshake/presence traffic)", () => {
  it("forwards unconditionally between peers in the same bucket, no registration needed", async () => {
    const bucket = uniqueBucket("plain");
    const a = await connect(bucket);
    const b = await connect(bucket);
    await settle();
    const pending = waitForMessage(b);
    a.send(frame(new Uint8Array([FRAME_PLAIN]), enc("syncStep1 or awareness, doesn't matter")));
    const received = await pending;
    expect(received).not.toBeNull();
    expect(received![0]).toBe(FRAME_PLAIN);
    a.close();
    b.close();
  });
});

describe("relay: FRAME_UPDATE authorization", () => {
  it("forwards an update signed by a properly registered editor", async () => {
    const bucket = uniqueBucket("update-ok");
    const editToken = new Uint8Array(32).fill(7);
    const kp = await generateSigningKeypair();
    const a = await connect(bucket);
    const b = await connect(bucket);
    await settle();

    a.send(frame(new Uint8Array([FRAME_REGISTER]), kp.publicKey, editToken));
    await settle();

    const ciphertext = enc("a real content change");
    const signature = await sign(ciphertext, kp.privateKey);
    const pending = waitForMessage(b);
    a.send(frame(new Uint8Array([FRAME_UPDATE]), kp.publicKey, signature, ciphertext));
    const received = await pending;

    expect(received).not.toBeNull();
    expect(received![0]).toBe(FRAME_UPDATE);
    a.close();
    b.close();
  });

  it("drops an update from a client that never registered — the core view-only guarantee", async () => {
    const bucket = uniqueBucket("unregistered");
    const kp = await generateSigningKeypair();
    const a = await connect(bucket);
    const b = await connect(bucket);
    await settle();

    // Correctly signed, but this pubkey was never registered as an editor
    // for this bucket — this is exactly what a view-only client (which
    // never has editToken to register with in the first place) would
    // produce if it tried to write anyway.
    const ciphertext = enc("an edit from someone who only has the content key");
    const signature = await sign(ciphertext, kp.privateKey);
    const pending = waitForMessage(b);
    a.send(frame(new Uint8Array([FRAME_UPDATE]), kp.publicKey, signature, ciphertext));
    const received = await pending;

    expect(received).toBeNull();
    a.close();
    b.close();
  });

  it("drops an update whose signature doesn't match its claimed pubkey", async () => {
    const bucket = uniqueBucket("forged");
    const editToken = new Uint8Array(32).fill(3);
    const kp = await generateSigningKeypair();
    const impostor = await generateSigningKeypair();
    const a = await connect(bucket);
    const b = await connect(bucket);
    await settle();

    a.send(frame(new Uint8Array([FRAME_REGISTER]), kp.publicKey, editToken));
    await settle();

    const ciphertext = enc("forged content");
    // Signed by a different key than the one claimed in the frame — the
    // relay must verify the signature actually matches the claimed pubkey,
    // not just that the claimed pubkey happens to be registered.
    const wrongSignature = await sign(ciphertext, impostor.privateKey);
    const pending = waitForMessage(b);
    a.send(frame(new Uint8Array([FRAME_UPDATE]), kp.publicKey, wrongSignature, ciphertext));
    const received = await pending;

    expect(received).toBeNull();
    a.close();
    b.close();
  });

  it("rejects a registration that presents a different editToken than whoever registered first", async () => {
    const bucket = uniqueBucket("mismatched-token");
    const kp1 = await generateSigningKeypair();
    const kp2 = await generateSigningKeypair();
    const editTokenReal = new Uint8Array(32).fill(1);
    const editTokenWrong = new Uint8Array(32).fill(2);
    const a = await connect(bucket);
    const b = await connect(bucket);
    const c = await connect(bucket);
    await settle();

    a.send(frame(new Uint8Array([FRAME_REGISTER]), kp1.publicKey, editTokenReal));
    await settle();
    // Someone without the real passphrase, guessing/using a wrong token —
    // this should NOT be accepted just because it's the second registrant.
    b.send(frame(new Uint8Array([FRAME_REGISTER]), kp2.publicKey, editTokenWrong));
    await settle();

    const ciphertext = enc("update from the wrongly-registered client");
    const signature = await sign(ciphertext, kp2.privateKey);
    const pending = waitForMessage(c);
    b.send(frame(new Uint8Array([FRAME_UPDATE]), kp2.publicKey, signature, ciphertext));
    const received = await pending;

    expect(received).toBeNull();
    a.close();
    b.close();
    c.close();
  });

  it("allows a second legitimate editor who presents the SAME editToken", async () => {
    const bucket = uniqueBucket("second-editor");
    const kp1 = await generateSigningKeypair();
    const kp2 = await generateSigningKeypair();
    const editToken = new Uint8Array(32).fill(5);
    const a = await connect(bucket);
    const b = await connect(bucket);
    const c = await connect(bucket);
    await settle();

    a.send(frame(new Uint8Array([FRAME_REGISTER]), kp1.publicKey, editToken));
    await settle();
    b.send(frame(new Uint8Array([FRAME_REGISTER]), kp2.publicKey, editToken)); // same token, different keypair
    await settle();

    const ciphertext = enc("update from the second editor");
    const signature = await sign(ciphertext, kp2.privateKey);
    const pending = waitForMessage(c);
    b.send(frame(new Uint8Array([FRAME_UPDATE]), kp2.publicKey, signature, ciphertext));
    const received = await pending;

    expect(received).not.toBeNull();
    expect(received![0]).toBe(FRAME_UPDATE);
    a.close();
    b.close();
    c.close();
  });
});

describe("relay: bucket isolation", () => {
  it("never forwards traffic between two different buckets", async () => {
    const bucketA = uniqueBucket("iso-a");
    const bucketB = uniqueBucket("iso-b");
    const a1 = await connect(bucketA);
    const b1 = await connect(bucketB);
    await settle();

    const pending = waitForMessage(b1);
    a1.send(frame(new Uint8Array([FRAME_PLAIN]), enc("only for bucket A")));
    const received = await pending;

    expect(received).toBeNull();
    a1.close();
    b1.close();
  });
});

describe("relay: REGISTER frames are never broadcast", () => {
  it("a peer never receives another peer's raw registration message", async () => {
    const bucket = uniqueBucket("no-register-leak");
    const kp = await generateSigningKeypair();
    const a = await connect(bucket);
    const b = await connect(bucket);
    await settle();

    const pending = waitForMessage(b);
    a.send(frame(new Uint8Array([FRAME_REGISTER]), kp.publicKey, new Uint8Array(32).fill(1)));
    const received = await pending;

    expect(received).toBeNull();
    a.close();
    b.close();
  });
});
