"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_KEY = "ponsplit:theme";

/**
 * Runs in <head> before the first paint: applies the saved theme (dark unless the visitor chose
 * light) and marks that JavaScript is running, which enables scroll reveals.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{d.setAttribute("data-theme",localStorage.getItem("${THEME_KEY}")==="light"?"light":"dark")}catch(e){}d.classList.add("js")})();`;

function current(): Theme {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** The active theme, kept in sync with <html data-theme>, and a setter that remembers the choice. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(current());
    const mo = new MutationObserver(() => setThemeState(current()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  };
  return [theme, setTheme];
}
