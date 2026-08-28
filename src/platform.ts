import { invoke, isTauri } from "@tauri-apps/api/core";

// True when this bundle is running inside the Tauri native shell (desktop
// app) rather than a plain browser tab pointed at the Node server. Same
// frontend bundle, same components — api.ts and collab.ts branch on this to
// pick invoke() (Tauri, calling into src-tauri/src/commands.rs) vs fetch()
// (browser, calling server/index.ts) for each operation.
export const IS_TAURI = isTauri();

export { invoke };
