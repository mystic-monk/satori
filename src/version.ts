import { version } from "../package.json";

// Single source of truth is package.json — src-tauri/tauri.conf.json's own
// "version" field is kept in sync by hand for now (no cross-tooling to
// enforce it yet); bump both together.
export const APP_VERSION = version;
