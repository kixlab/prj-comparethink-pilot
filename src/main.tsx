import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./pilot/App";
import { captureAccessKey } from "./pilot/access";
import { I18nProvider } from "./pilot/i18n";
import "./pilot/style.css";
captureAccessKey();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
