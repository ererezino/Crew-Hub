"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";

import { buildTreeFromPeople, computeTreeLayout } from "../../lib/org-chart/layout";
import type { OrgChartPerson, PositionedNode } from "../../lib/org-chart/types";
import { OrgChartNode } from "./org-chart-node";

type OrgChartTreeProps = {
  people: OrgChartPerson[];
  selectedPersonId: string | null;
  onSelectPerson: (personId: string | null) => void;
  showOperationalLeads: boolean;
  onZoomChange?: (scale: number) => void;
};

export type OrgChartTreeHandle = {
  fitToScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

const PADDING = 60;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

type Transform = { x: number; y: number; scale: number };

function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export const OrgChartTree = forwardRef<OrgChartTreeHandle, OrgChartTreeProps>(
  function OrgChartTree(
    { people, selectedPersonId, onSelectPerson, showOperationalLeads, onZoomChange },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

    // Build tree layout
    const layoutData = useMemo(() => {
      const treeInput = people.map((p) => ({ id: p.id, parentId: p.managerId }));
      const roots = buildTreeFromPeople(treeInput);
      return computeTreeLayout(roots);
    }, [people]);

    // Direct report counts
    const reportCounts = useMemo(() => {
      const counts = new Map<string, number>();
      for (const person of people) {
        if (person.managerId) {
          counts.set(person.managerId, (counts.get(person.managerId) ?? 0) + 1);
        }
      }
      return counts;
    }, [people]);

    // Build person lookup
    const personMap = useMemo(() => {
      const map = new Map<string, OrgChartPerson>();
      for (const p of people) {
        map.set(p.id, p);
      }
      return map;
    }, [people]);

    // Compute chart bounds
    const bounds = useMemo(() => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const pos of layoutData.values()) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + pos.width);
        maxY = Math.max(maxY, pos.y + pos.height);
      }

      if (!isFinite(minX)) {
        return { x: 0, y: 0, width: 400, height: 300 };
      }

      return {
        x: minX - PADDING,
        y: minY - PADDING,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2
      };
    }, [layoutData]);

    // Notify parent of zoom changes
    useEffect(() => {
      onZoomChange?.(transform.scale);
    }, [transform.scale, onZoomChange]);

    // Fit to screen
    const fitToScreen = useCallback(() => {
      const container = containerRef.current;
      if (!container || bounds.width === 0) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      const scaleX = containerWidth / bounds.width;
      const scaleY = containerHeight / bounds.height;
      const scale = clampScale(Math.min(scaleX, scaleY) * 0.9);

      const scaledWidth = bounds.width * scale;
      const scaledHeight = bounds.height * scale;

      setTransform({
        x: (containerWidth - scaledWidth) / 2 - bounds.x * scale,
        y: (containerHeight - scaledHeight) / 2 - bounds.y * scale,
        scale
      });
    }, [bounds]);

    const zoomIn = useCallback(() => {
      setTransform((prev) => {
        const container = containerRef.current;
        if (!container) return prev;
        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;
        const nextScale = clampScale(prev.scale + ZOOM_STEP);
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: centerX - (centerX - prev.x) * ratio,
          y: centerY - (centerY - prev.y) * ratio
        };
      });
    }, []);

    const zoomOut = useCallback(() => {
      setTransform((prev) => {
        const container = containerRef.current;
        if (!container) return prev;
        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;
        const nextScale = clampScale(prev.scale - ZOOM_STEP);
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: centerX - (centerX - prev.x) * ratio,
          y: centerY - (centerY - prev.y) * ratio
        };
      });
    }, []);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({ fitToScreen, zoomIn, zoomOut }), [fitToScreen, zoomIn, zoomOut]);

    // Fit to screen on mount / data change
    useEffect(() => {
      fitToScreen();
    }, [fitToScreen]);

    // Pan handlers
    const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest(".org-chart-node")) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, [transform.x, transform.y]);

    const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const start = panStart.current;
      if (!isPanning || !start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      setTransform((prev) => ({ ...prev, x: start.tx + dx, y: start.ty + dy }));
    }, [isPanning]);

    const handlePointerUp = useCallback(() => {
      setIsPanning(false);
      panStart.current = null;
    }, []);

    // Wheel zoom
    const handleWheel = useCallback((e: WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform((prev) => {
        const direction = e.deltaY < 0 ? 1 : -1;
        const nextScale = clampScale(prev.scale + direction * ZOOM_STEP);
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: mouseX - (mouseX - prev.x) * ratio,
          y: mouseY - (mouseY - prev.y) * ratio
        };
      });
    }, []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      container.addEventListener("wheel", handleWheel, { passive: false });
      return () => container.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    // Build reporting edges
    const reportingEdges = useMemo(() => {
      const edges: { from: PositionedNode; to: PositionedNode }[] = [];
      for (const person of people) {
        if (!person.managerId) continue;
        const fromPos = layoutData.get(person.managerId);
        const toPos = layoutData.get(person.id);
        if (fromPos && toPos) {
          edges.push({ from: fromPos, to: toPos });
        }
      }
      return edges;
    }, [people, layoutData]);

    // Build operational lead overlay edges
    const operationalLeadEdges = useMemo(() => {
      if (!showOperationalLeads) return [];
      const edges: { from: PositionedNode; to: PositionedNode }[] = [];
      for (const person of people) {
        if (!person.teamLeadId || person.teamLeadId === person.managerId) continue;
        const fromPos = layoutData.get(person.teamLeadId);
        const toPos = layoutData.get(person.id);
        if (fromPos && toPos) {
          edges.push({ from: fromPos, to: toPos });
        }
      }
      return edges;
    }, [people, layoutData, showOperationalLeads]);

    // Click empty space to deselect
    const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      if (!(e.target as HTMLElement).closest(".org-chart-node")) {
        onSelectPerson(null);
      }
    }, [onSelectPerson]);

    return (
      <div
        ref={containerRef}
        className={`org-chart-canvas${isPanning ? " org-chart-canvas-panning" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleContainerClick}
        role="img"
        aria-label="Organization chart"
      >
        <div
          className="org-chart-transform-layer"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "0 0"
          }}
        >
          {/* SVG layer for edges */}
          <svg
            className="org-chart-edges-svg"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: bounds.x + bounds.width + PADDING,
              height: bounds.y + bounds.height + PADDING,
              pointerEvents: "none",
              overflow: "visible"
            }}
          >
            {/* Reporting edges — solid */}
            {reportingEdges.map((edge) => {
              const startX = edge.from.x + edge.from.width / 2;
              const startY = edge.from.y + edge.from.height;
              const endX = edge.to.x + edge.to.width / 2;
              const endY = edge.to.y;
              const midY = startY + (endY - startY) / 2;

              return (
                <path
                  key={`report-${edge.from.id}-${edge.to.id}`}
                  d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
                  fill="none"
                  stroke="var(--color-border-muted, #cbd5e1)"
                  strokeWidth="1.5"
                />
              );
            })}

            {/* Operational lead edges — dashed blue */}
            {operationalLeadEdges.map((edge) => {
              const startX = edge.from.x + edge.from.width / 2;
              const startY = edge.from.y + edge.from.height;
              const endX = edge.to.x + edge.to.width / 2;
              const endY = edge.to.y;
              const midY = startY + (endY - startY) / 2;
              const labelX = (startX + endX) / 2;
              const labelY = midY;

              return (
                <g key={`ol-${edge.from.id}-${edge.to.id}`}>
                  <path
                    d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="var(--color-accent, #60a5fa)"
                    strokeWidth="1.5"
                    strokeDasharray="6 4"
                  />
                  <rect
                    x={labelX - 12}
                    y={labelY - 8}
                    width={24}
                    height={16}
                    rx={4}
                    fill="var(--color-accent, #60a5fa)"
                  />
                  <text
                    x={labelX}
                    y={labelY + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="9"
                    fontWeight="600"
                  >
                    OL
                  </text>
                </g>
              );
            })}
          </svg>

          {/* HTML layer for node cards */}
          {Array.from(layoutData.entries()).map(([personId, pos]) => {
            const person = personMap.get(personId);
            if (!person) return null;

            return (
              <div
                key={personId}
                className="org-chart-node-wrapper"
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: pos.width,
                  height: pos.height
                }}
              >
                <OrgChartNode
                  person={person}
                  isSelected={selectedPersonId === personId}
                  onSelect={onSelectPerson}
                  directReportCount={reportCounts.get(personId) ?? 0}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
