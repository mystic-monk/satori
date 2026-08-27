import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";
import { applyStoredTheme } from "./themes";

applyStoredTheme(); // before the first paint, so there's no flash of the wrong theme

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
