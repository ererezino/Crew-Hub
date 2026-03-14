import type { LayoutNode, PositionedNode } from "./types";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const HORIZONTAL_GAP = 32;
const VERTICAL_GAP = 64;

/**
 * Build a forest of LayoutNode trees from a flat list of { id, parentId } pairs.
 * People with parentId = null become roots.
 */
export function buildTreeFromPeople(
  people: readonly { id: string; parentId: string | null }[]
): LayoutNode[] {
  const nodeMap = new Map<string, LayoutNode>();

  for (const person of people) {
    nodeMap.set(person.id, {
      id: person.id,
      parentId: person.parentId,
      children: []
    });
  }

  const roots: LayoutNode[] = [];

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Simplified Walker's algorithm for tree layout.
 *
 * Assigns (x, y) positions to each node in a top-down tree layout.
 * Handles multiple roots (forest) by laying them out side-by-side.
 *
 * Returns a Map from node id to positioned node.
 */
export function computeTreeLayout(roots: LayoutNode[]): Map<string, PositionedNode> {
  const positions = new Map<string, PositionedNode>();

  // First pass: compute subtree widths
  const subtreeWidths = new Map<string, number>();

  function computeSubtreeWidth(node: LayoutNode): number {
    if (node.children.length === 0) {
      const width = NODE_WIDTH;
      subtreeWidths.set(node.id, width);
      return width;
    }

    let totalChildWidth = 0;
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) {
        totalChildWidth += HORIZONTAL_GAP;
      }
      totalChildWidth += computeSubtreeWidth(node.children[i]);
    }

    const width = Math.max(NODE_WIDTH, totalChildWidth);
    subtreeWidths.set(node.id, width);
    return width;
  }

  // Compute subtree widths for all roots
  for (const root of roots) {
    computeSubtreeWidth(root);
  }

  // Second pass: assign positions
  function assignPositions(node: LayoutNode, centerX: number, y: number): void {
    positions.set(node.id, {
      id: node.id,
      x: centerX - NODE_WIDTH / 2,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT
    });

    if (node.children.length === 0) {
      return;
    }

    const childY = y + NODE_HEIGHT + VERTICAL_GAP;

    // Calculate total width of children
    let totalChildWidth = 0;
    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) {
        totalChildWidth += HORIZONTAL_GAP;
      }
      totalChildWidth += subtreeWidths.get(node.children[i].id) ?? NODE_WIDTH;
    }

    // Start children centered under parent
    let childX = centerX - totalChildWidth / 2;

    for (const child of node.children) {
      const childSubtreeWidth = subtreeWidths.get(child.id) ?? NODE_WIDTH;
      const childCenterX = childX + childSubtreeWidth / 2;
      assignPositions(child, childCenterX, childY);
      childX += childSubtreeWidth + HORIZONTAL_GAP;
    }
  }

  // Lay out each root tree side by side
  let forestX = 0;
  for (const root of roots) {
    const rootWidth = subtreeWidths.get(root.id) ?? NODE_WIDTH;
    const rootCenterX = forestX + rootWidth / 2;
    assignPositions(root, rootCenterX, 0);
    forestX += rootWidth + HORIZONTAL_GAP;
  }

  return positions;
}

export { NODE_WIDTH, NODE_HEIGHT };
