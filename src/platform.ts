import { invoke, isTauri } from "@tauri-apps/api/core";

// True when this bundle is running inside the Tauri native shell (desktop
// app) rather than a plain browser tab pointed at the Node server. Same
// frontend bundle, same components — api.ts and collab.ts branch on this to
// pick invoke() (Tauri, calling into src-tauri/src/commands.rs) vs fetch()
// (browser, calling server/index.ts) for each operation.
export const IS_TAURI = isTauri();

export { invoke };

// Best-effort starting guess for the cloud-sync relay field (App.tsx's
// relayUrl state, persisted to localStorage and user-editable from there).
// Only a reasonable guess in local dev, where the frontend and API happen
// to share a host and the API happens to be on 3001 — empty in Tauri mode,
// where there is no bundled relay process to guess at (see the long-term
// "no sidecar" architecture decision — cloud sync needs a relay the user
// points at explicitly, not one derived from the app's own location).
export function defaultRelayUrl(): string {
  if (IS_TAURI) return "";
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:3001`;
}
