// Renderer entry. The dev bridge must load first: it fills `window.agentherd` in a plain browser.

import "./dev-bridge";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initFontScale } from "./font-scale";

initFontScale();

// Electron on macOS draws the window with vibrancy; a plain browser preview does not.
if (navigator.userAgent.includes("Mac") && navigator.userAgent.includes("Electron"))
  document.documentElement.classList.add("ah-vibrancy");

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
