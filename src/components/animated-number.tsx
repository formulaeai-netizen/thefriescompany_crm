import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
};

// Ease-out cubic
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedNumber({ value, format, duration = 900, className }: Props) {
  const [display, setDisplay] = useState(0);
  const animatedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!Number.isFinite(value)) {
      setDisplay(0);
      return;
    }

    if (animatedRef.current) {
      // After first mount, snap to latest value so dashboard filters update immediately.
      setDisplay(value);
      return;
    }

    animatedRef.current = true;
    const start = performance.now();
    const from = 0;
    const to = value;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * easeOut(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [duration, value]);

  const rendered = format ? format(display) : Math.round(display).toLocaleString();
  return <span className={className}>{rendered}</span>;
}