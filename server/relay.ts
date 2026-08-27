import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HttpServer } from "node:http";

// Cloud-mode relay. Deliberately dumb: it forwards opaque binary blobs
// between peers in the same room and nothing else. No Yjs, no decoding, no
// persistence, no key material — this process can only ever see ciphertext,
// which is the whole point (see src/crypto.ts and src/cloud-collab.ts on the
// client for where the actual encryption happens).
//
// This is also why cloud mode has no server-enforced view/comment/edit
// roles the way local mode does (server/collab.ts): enforcing "this peer
// can't write" means inspecting messages, which means decoding them, which
// breaks the one guarantee this file exists to provide. Real role
// enforcement under encryption needs an asymmetric scheme (e.g. per-role
// Ed25519 signing keys, with the relay checking signatures — which doesn't
// require decrypting content) layered on top of the symmetric secretbox
// encryption used today. Not built for v1; cloud-mode sharing is
// effectively "whoever has the passphrase can read and write."
const rooms = new Map<string, Set<WebSocket>>();

export function setupRelayServer(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/relay/")) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket, req) => {
    const room = decodeURIComponent(req.url!.replace("/relay/", ""));
    let peers = rooms.get(room);
    if (!peers) {
      peers = new Set();
      rooms.set(room, peers);
    }
    peers.add(ws);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      for (const peer of peers!) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) peer.send(data, { binary: isBinary });
      }
    });

    ws.on("close", () => {
      peers!.delete(ws);
      if (peers!.size === 0) rooms.delete(room);
    });
  });

  console.log("cloud relay (opaque blobs only) attached at ws://<host>/relay/<room>");
}
