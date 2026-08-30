import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickCapture from "./QuickCapture";
import "./index.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { applyStoredTheme } from "./themes";

applyStoredTheme(); // before the first paint, so there's no flash of the wrong theme

// The Quick Capture window (src-tauri/src/lib.rs's open_quick_capture)
// points at this same index.html with ?quickcapture=1 rather than a
// separate Vite entry — one bundle, branch on the query param, same
// pattern as choosing IS_TAURI vs browser inside components rather than
// maintaining two build targets.
const isQuickCapture = new URLSearchParams(window.location.search).get("quickcapture") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isQuickCapture ? <QuickCapture /> : <App />}</React.StrictMode>
);
