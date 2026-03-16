"use client";

import { useCallback, useEffect, useRef } from "react";

type AnimatedNumberProps = {
  value: number;
  format?: "number" | "currency" | "percentage";
  currency?: string;
  className?: string;
};

const zeroFractionCurrencies = new Set(["JPY", "KRW"]);

function formatAnimatedValue(raw: number, format: string, currency?: string): string {
  if (format === "currency" && currency) {
    const normalizedCurrency = currency.trim().toUpperCase();
    const fractionDigits = zeroFractionCurrencies.has(normalizedCurrency) ? 0 : 2;
    const majorAmount = raw / 10 ** fractionDigits;

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(majorAmount);
  }

  if (format === "percentage") {
    return `${raw.toFixed(1)}%`;
  }

  return Math.round(raw).toLocaleString();
}

// Simple spring physics: critically-damped spring towards target
function springStep(
  current: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): [number, number] {
  const force = stiffness * (target - current);
  const dampingForce = damping * velocity;
  const acceleration = force - dampingForce;
  const newVelocity = velocity + acceleration * dt;
  const newCurrent = current + newVelocity * dt;
  return [newCurrent, newVelocity];
}

export function AnimatedNumber({
  value,
  format = "number",
  currency,
  className
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<{
    current: number;
    velocity: number;
    target: number;
    rafId: number | null;
  }>({ current: 0, velocity: 0, target: 0, rafId: null });

  const startAnimation = useCallback(() => {
    const state = animationRef.current;
    let lastTime: number | null = null;

    function tick(time: number) {
      if (lastTime === null) {
        lastTime = time;
        state.rafId = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min((time - lastTime) / 1000, 0.05); // cap dt at 50ms
      lastTime = time;

      [state.current, state.velocity] = springStep(
        state.current,
        state.velocity,
        state.target,
        80,  // stiffness
        20,  // damping
        dt
      );

      if (ref.current) {
        ref.current.textContent = formatAnimatedValue(state.current, format, currency);
      }

      // Stop when close enough and velocity is negligible
      if (Math.abs(state.target - state.current) < 0.5 && Math.abs(state.velocity) < 0.5) {
        state.current = state.target;
        state.velocity = 0;
        if (ref.current) {
          ref.current.textContent = formatAnimatedValue(state.target, format, currency);
        }
        state.rafId = null;
        return;
      }

      state.rafId = requestAnimationFrame(tick);
    }

    state.rafId = requestAnimationFrame(tick);
  }, [format, currency]);

  useEffect(() => {
    const el = ref.current;
    const anim = animationRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          anim.target = value;
          startAnimation();
        }
      },
      { rootMargin: "-40px" }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (anim.rafId !== null) {
        cancelAnimationFrame(anim.rafId);
      }
    };
  }, [value, startAnimation]);

  // Update target when value changes after initial animation
  useEffect(() => {
    const state = animationRef.current;
    if (state.target !== 0 || state.current !== 0) {
      state.target = value;
      if (state.rafId === null) {
        startAnimation();
      }
    }
  }, [value, startAnimation]);

  return (
    <span ref={ref} className={className}>
      {formatAnimatedValue(0, format, currency)}
    </span>
  );
}
