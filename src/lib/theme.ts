"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_KEY = "ponsplit:theme";
/** The desktop sidebar folded to icons (see Sidebar.tsx); restored before paint like the theme. */
export const SIDEBAR_KEY = "splitearn:sidebar";

/** The browser toolbar color for each theme (<meta name="theme-color">). */
const BAR = { dark: "#0b0e11", light: "#f5f7f8" };

/**
 * Runs in <head> before the first paint: applies the saved theme (dark unless the visitor chose
 * light) and sidebar width, adds the browser toolbar color to match (a tag React doesn't own, so navigation leaves
 * it alone) and marks that JavaScript is running, which enables scroll reveals. If the app hasn't
 * hydrated 2.5 s later (a failed or very slow bundle), the mark comes off again so no content
 * stays hidden behind a reveal that will never run.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,t="dark";try{if(localStorage.getItem("${THEME_KEY}")==="light")t="light"}catch(e){}d.setAttribute("data-theme",t);try{if(localStorage.getItem("${SIDEBAR_KEY}")==="folded")d.setAttribute("data-sidebar","folded")}catch(e){}var m=document.createElement("meta");m.name="theme-color";m.content=t==="light"?"${BAR.light}":"${BAR.dark}";document.head.appendChild(m);d.classList.add("js");setTimeout(function(){if(!d.hasAttribute("data-hydrated"))d.classList.remove("js")},2500)})();`;

/** Keeps the browser toolbar in the page's color. */
function paintBar(t: Theme) {
  let m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement("meta");
    m.name = "theme-color";
    document.head.appendChild(m);
  }
  m.content = BAR[t];
}

function current(): Theme {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** The active theme, kept in sync with <html data-theme>, and a setter that remembers the choice. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    // Tells THEME_SCRIPT's failsafe that the app is running. Providers uses this hook, so it runs
    // on every page, whether or not the page has anything to reveal.
    document.documentElement.setAttribute("data-hydrated", "");
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
