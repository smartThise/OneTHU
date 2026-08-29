import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@onethu/ui/tokens.css";
import "@onethu/ui/base.css";
import "./styles/global.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
