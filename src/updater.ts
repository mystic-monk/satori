// Thin wrapper around @tauri-apps/plugin-updater — Tauri-only (there's no
// equivalent concept for the browser deployment, which is just whatever
// the server operator has deployed). Kept separate from api.ts since this
// wraps a Tauri plugin directly rather than an invoke() command.
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export async function checkForUpdate(): Promise<Update | null> {
  return check();
}

export async function installUpdateAndRelaunch(
  update: Update,
  onProgress?: (downloaded: number, total: number | undefined) => void
): Promise<void> {
  let downloaded = 0;
  let total: number | undefined;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded, total);
    }
  });
  await relaunch();
}
