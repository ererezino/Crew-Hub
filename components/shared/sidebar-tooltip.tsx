"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type SidebarTooltipProps = {
  label: string;
  enabled: boolean;
  children: ReactNode;
};

/**
 * Wraps a single sidebar link and shows a tooltip to the right when
 * `enabled` is true. Renders the tooltip via a portal so it escapes
 * any overflow:hidden ancestors in the sidebar.
 *
 * Attaches native DOM event listeners to the first child element so
 * hover/focus work reliably even with display:contents wrapper.
 */
export function SidebarTooltip({ label, enabled, children }: SidebarTooltipProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Attach native DOM listeners to the first child element.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !enabled) return;
    const target = wrapper.firstElementChild as HTMLElement | null;
    if (!target) return;

    const handleEnter = () => {
      const rect = target.getBoundingClientRect();
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
      setHovered(true);
    };
    const handleLeave = () => setHovered(false);

    target.addEventListener("mouseenter", handleEnter);
    target.addEventListener("mouseleave", handleLeave);
    target.addEventListener("focus", handleEnter);
    target.addEventListener("blur", handleLeave);

    return () => {
      target.removeEventListener("mouseenter", handleEnter);
      target.removeEventListener("mouseleave", handleLeave);
      target.removeEventListener("focus", handleEnter);
      target.removeEventListener("blur", handleLeave);
      setHovered(false);
    };
  }, [enabled]);

  // Set aria-label on the child element when enabled (keyboard accessibility)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const target = wrapper.firstElementChild as HTMLElement | null;
    if (!target) return;

    if (enabled) {
      target.setAttribute("aria-label", label);
    } else {
      target.removeAttribute("aria-label");
    }
  }, [enabled, label]);

  // Only show when both enabled AND hovered
  const showTooltip = enabled && hovered;

  return (
    <span ref={wrapperRef} style={{ display: "contents" }}>
      {children}
      {showTooltip
        ? createPortal(
            <div
              role="tooltip"
              className="sidebar-tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                transform: "translateY(-50%)",
                zIndex: 10000,
              }}
            >
              <span className="sidebar-tooltip-arrow" />
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
