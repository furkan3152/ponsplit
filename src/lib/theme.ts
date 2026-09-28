"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_KEY = "ponsplit:theme";

/** The browser toolbar color for each theme (<meta name="theme-color">). */
const BAR = { dark: "#09090b", light: "#f3f2ec" };

/**
 * Runs in <head> before the first paint: applies the saved theme (dark unless the visitor chose
 * light) and marks that JavaScript is running, which enables scroll reveals. If the app hasn't
 * hydrated 2.5 s later (a failed or very slow bundle), the mark comes off again so no content
 * stays hidden behind a reveal that will never run.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{d.setAttribute("data-theme",localStorage.getItem("${THEME_KEY}")==="light"?"light":"dark")}catch(e){}d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-hydrated"))d.classList.remove("js")},2500)})();`;

/** Keeps the browser toolbar in the page's color. */
function paintBar(t: Theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
}

function current(): Theme {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** The active theme, kept in sync with <html data-theme>, and a setter that remembers the choice. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(current());
    paintBar(current());
    const mo = new MutationObserver(() => {
      setThemeState(current());
      paintBar(current());
    });
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
