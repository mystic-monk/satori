import { IS_TAURI } from "./platform";

// Native OS notifications in Tauri (via tauri-plugin-notification, wired
// up in src-tauri/src/lib.rs), the Web Notification API in the browser
// deployment — both only fire while Satori is actually open (a tab, or
// the native window running); neither path is a true background/push
// notification, which would need a lot more infrastructure (a service
// worker + push server for the browser, a background daemon for Tauri).
// Documented as a known limitation rather than silently pretended away.
export async function requestNotificationPermission(): Promise<boolean> {
  if (IS_TAURI) {
    const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  }
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function fireNotification(title: string, body: string): Promise<void> {
  if (IS_TAURI) {
    const { sendNotification } = await import("@tauri-apps/plugin-notification");
    sendNotification({ title, body });
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}
