"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

/** True when the visitor asked the OS for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Whether the element has scrolled into view (once, by default). */
export function useInView<T extends Element>({ once = true, rootMargin = "0px 0px -8% 0px" }: { once?: boolean; rootMargin?: string } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin]);
  return [ref, inView] as const;
}

/**
 * Fades and lifts its children in when they scroll into view. `delay` (ms) staggers siblings.
 * Without JavaScript, or with reduced motion, the content is simply shown.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
  style,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
  style?: CSSProperties;
}) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <Tag ref={ref} className={`reveal ${inView ? "is-in" : ""} ${className}`} style={{ ...style, transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/**
 * Counts from the previous value (0 at first) up to `value` once visible, easing out. `format`
 * turns the in-between number into text; an undefined value shows `placeholder`.
 */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  duration = 1100,
  placeholder = "–",
  className,
}: {
  value: number | undefined;
  format?: (n: number) => string;
  duration?: number;
  placeholder?: string;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>({ rootMargin: "0px" });
  const [shown, setShown] = useState<number | undefined>(undefined);
  const from = useRef(0);
  useEffect(() => {
    if (value === undefined) return;
    // Without motion the number is simply shown, whether or not it has scrolled into view yet.
    if (prefersReducedMotion() || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    if (!inView) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, inView, duration]);
  return (
    <span ref={ref} className={className}>
      {value === undefined ? placeholder : format(shown ?? 0)}
    </span>
  );
}

/**
 * Wraps a live number and flashes it green or red when it goes up or down, like a trading
 * terminal. `value` is what gets compared (number or bigint); `children` is what is shown.
 */
export function Flash({ value, children, className = "" }: { value: number | bigint | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === undefined || value === undefined || p === value) return;
    setDir(value > p ? "up" : "down");
    setTick((t) => t + 1);
  }, [value]);
  return (
    <span
      key={tick}
      className={`rounded-md ${dir === "up" ? "animate-flash-up" : dir === "down" ? "animate-flash-down" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

const CONFETTI_COLORS = ["#ff7a3d", "#66c7ff", "#ff8ccf", "#ffd45c", "#a98dff", "#3ddc97"];

/** A burst of confetti in the house colors, for launches, claims and graduations. */
export async function celebrate(): Promise<void> {
  if (typeof window === "undefined" || prefersReducedMotion()) return;
  const { default: confetti } = await import("canvas-confetti");
  const base = { colors: CONFETTI_COLORS, disableForReducedMotion: true, zIndex: 80 };
  confetti({ ...base, particleCount: 110, spread: 80, startVelocity: 42, origin: { y: 0.72 }, scalar: 1.05 });
  setTimeout(() => confetti({ ...base, particleCount: 55, angle: 60, spread: 58, origin: { x: 0, y: 0.8 } }), 160);
  setTimeout(() => confetti({ ...base, particleCount: 55, angle: 120, spread: 58, origin: { x: 1, y: 0.8 } }), 280);
}
