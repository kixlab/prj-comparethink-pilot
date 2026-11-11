import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { translate, type Language } from "./translations";

const I18nContext = createContext({
  language: "en" as Language,
  setLanguage: (_value: Language) => {},
  t: (key: string, values?: Record<string, string | number>) =>
    translate("en", key, values),
});
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const query = new URLSearchParams(location.search).get("lang");
    if (query === "en" || query === "ko") return query;
    try {
      return localStorage.getItem("comparethink-language") === "ko"
        ? "ko"
        : "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem("comparethink-language", language);
    } catch {
      /* UI preference storage is optional. */
    }
  }, [language]);
  const changeLanguage = (value: Language) => {
    setLanguage(value);
    const url = new URL(location.href);
    url.searchParams.set("lang", value);
    history.replaceState(null, "", url);
  };
  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage: changeLanguage,
        t: (key, values) => translate(language, key, values),
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}
export const useI18n = () => useContext(I18nContext);
