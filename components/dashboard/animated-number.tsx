"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "framer-motion";

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

export function AnimatedNumber({
  value,
  format = "number",
  currency,
  className
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    stiffness: 80,
    damping: 20,
    mass: 1
  });
  const isInView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    if (isInView) {
      motionValue.set(value);
    }
  }, [isInView, motionValue, value]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      if (!ref.current) return;
      ref.current.textContent = formatAnimatedValue(latest, format, currency);
    });

    return unsubscribe;
  }, [springValue, format, currency]);

  return (
    <span ref={ref} className={className}>
      {formatAnimatedValue(0, format, currency)}
    </span>
  );
}
