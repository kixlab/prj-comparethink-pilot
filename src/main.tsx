import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./pilot/App";
import { I18nProvider } from "./pilot/i18n";
import "./pilot/style.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
