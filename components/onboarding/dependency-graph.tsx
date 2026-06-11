"use client";

import { useId, useMemo } from "react";

import type { OnboardingTaskStatus } from "../../types/onboarding";

export type DependencyGraphNode = {
  id: string;
  title: string;
  /** When present (instance variant) the node is tinted with the task status tokens. */
  status?: OnboardingTaskStatus;
  /** Ids of prerequisite nodes (same id space as `id`). Unknown ids are ignored. */
  dependsOn: readonly string[];
};

export type DependencyGraphLabels = {
  /** Accessible label for the SVG graph. */
  aria: string;
  /** Heading shown above the compact list of tasks with no deps and no dependents. */
  independentHeading: string;
};

type DependencyGraphProps = {
  nodes: readonly DependencyGraphNode[];
  labels: DependencyGraphLabels;
};

const NODE_WIDTH = 176;
const NODE_HEIGHT = 44;
const COLUMN_GAP = 64;
const ROW_GAP = 16;
const PADDING = 12;
const MAX_TITLE_CHARS = 22;

type NodePosition = {
  x: number;
  y: number;
};

type GraphEdge = {
  fromId: string;
  toId: string;
};

type GraphLayout = {
  connectedNodes: DependencyGraphNode[];
  standaloneNodes: DependencyGraphNode[];
  positionById: Map<string, NodePosition>;
  edges: GraphEdge[];
  width: number;
  height: number;
};

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_CHARS
    ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…`
    : title;
}

function nodeClassName(status?: OnboardingTaskStatus): string {
  return status ? `dependency-node dependency-node-${status}` : "dependency-node";
}

function standaloneClassName(status?: OnboardingTaskStatus): string {
  return status
    ? `dependency-graph-standalone-item dependency-graph-standalone-item-${status}`
    : "dependency-graph-standalone-item";
}

function computeLayout(nodes: readonly DependencyGraphNode[]): GraphLayout {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const validDepsById = new Map<string, string[]>();
  const idsWithDependents = new Set<string>();

  for (const node of nodes) {
    const validDeps = [...new Set(node.dependsOn)].filter(
      (depId) => depId !== node.id && nodeById.has(depId)
    );
    validDepsById.set(node.id, validDeps);

    for (const depId of validDeps) {
      idsWithDependents.add(depId);
    }
  }

  /* Topological depth: 0 for roots, 1 + max(prereq depth) otherwise.
     A visiting set guards against transient cycles in live form state
     (the server rejects them, but the live preview must never hang). */
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (nodeId: string): number => {
    const knownDepth = depthById.get(nodeId);

    if (knownDepth !== undefined) {
      return knownDepth;
    }

    if (visiting.has(nodeId)) {
      return 0;
    }

    visiting.add(nodeId);
    const deps = validDepsById.get(nodeId) ?? [];
    const depth =
      deps.length === 0 ? 0 : Math.max(...deps.map((depId) => depthOf(depId))) + 1;
    visiting.delete(nodeId);
    depthById.set(nodeId, depth);

    return depth;
  };

  for (const node of nodes) {
    depthOf(node.id);
  }

  const connectedIds = new Set<string>();

  for (const node of nodes) {
    if ((validDepsById.get(node.id)?.length ?? 0) > 0 || idsWithDependents.has(node.id)) {
      connectedIds.add(node.id);
    }
  }

  const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
  const standaloneNodes = nodes.filter((node) => !connectedIds.has(node.id));

  const columns = new Map<number, DependencyGraphNode[]>();

  for (const node of connectedNodes) {
    const depth = depthById.get(node.id) ?? 0;
    const columnNodes = columns.get(depth) ?? [];
    columnNodes.push(node);
    columns.set(depth, columnNodes);
  }

  const columnCount = columns.size === 0 ? 0 : Math.max(...columns.keys()) + 1;
  const maxRows =
    columns.size === 0
      ? 0
      : Math.max(...[...columns.values()].map((columnNodes) => columnNodes.length));

  const positionById = new Map<string, NodePosition>();

  for (const [depth, columnNodes] of columns) {
    const verticalOffset =
      ((maxRows - columnNodes.length) * (NODE_HEIGHT + ROW_GAP)) / 2;

    columnNodes.forEach((node, rowIndex) => {
      positionById.set(node.id, {
        x: PADDING + depth * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + verticalOffset + rowIndex * (NODE_HEIGHT + ROW_GAP)
      });
    });
  }

  const edges: GraphEdge[] = [];

  for (const node of connectedNodes) {
    for (const depId of validDepsById.get(node.id) ?? []) {
      edges.push({ fromId: depId, toId: node.id });
    }
  }

  const width =
    columnCount === 0
      ? 0
      : PADDING * 2 + columnCount * NODE_WIDTH + (columnCount - 1) * COLUMN_GAP;
  const height =
    maxRows === 0
      ? 0
      : PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP;

  return { connectedNodes, standaloneNodes, positionById, edges, width, height };
}

function edgePath(from: NodePosition, to: NodePosition): string {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x - 2;
  const endY = to.y + NODE_HEIGHT / 2;
  const midX = (startX + endX) / 2;

  return `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
}

export function DependencyGraph({ nodes, labels }: DependencyGraphProps) {
  const markerId = useId();
  const layout = useMemo(() => computeLayout(nodes), [nodes]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="dependency-graph">
      {layout.connectedNodes.length > 0 ? (
        <div className="dependency-graph-container">
          <svg
            className="dependency-graph-svg"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={labels.aria}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 z" className="dependency-edge-arrow" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const fromPosition = layout.positionById.get(edge.fromId);
              const toPosition = layout.positionById.get(edge.toId);

              if (!fromPosition || !toPosition) {
                return null;
              }

              return (
                <path
                  key={`edge-${edge.fromId}-${edge.toId}`}
                  className="dependency-edge"
                  d={edgePath(fromPosition, toPosition)}
                  markerEnd={`url(#${markerId})`}
                />
              );
            })}
            {layout.connectedNodes.map((node) => {
              const position = layout.positionById.get(node.id);

              if (!position) {
                return null;
              }

              return (
                <g key={`node-${node.id}`} className={nodeClassName(node.status)}>
                  <title>{node.title}</title>
                  <rect
                    x={position.x}
                    y={position.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={10}
                  />
                  <text
                    x={position.x + 12}
                    y={position.y + NODE_HEIGHT / 2}
                    dominantBaseline="central"
                  >
                    {truncateTitle(node.title)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}

      {layout.standaloneNodes.length > 0 ? (
        <>
          <p className="dependency-graph-standalone-heading">
            {labels.independentHeading}
          </p>
          <ul className="dependency-graph-standalone">
            {layout.standaloneNodes.map((node) => (
              <li
                key={`standalone-${node.id}`}
                className={standaloneClassName(node.status)}
                title={node.title}
              >
                {truncateTitle(node.title)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
