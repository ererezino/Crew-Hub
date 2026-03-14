/** Minimal person data needed for org chart layout and rendering. */
export type OrgChartPerson = {
  id: string;
  fullName: string;
  title: string | null;
  department: string | null;
  roles: string[];
  status: string;
  avatarUrl: string | null;
  managerId: string | null;
  teamLeadId: string | null;
  teamLeadName: string | null;
};

/** Input to the tree layout algorithm. */
export type LayoutNode = {
  id: string;
  parentId: string | null;
  children: LayoutNode[];
};

/** Positioned node output from the layout algorithm. */
export type PositionedNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Edge between two positioned nodes. */
export type LayoutEdge = {
  fromId: string;
  toId: string;
  /** Whether this is an operational-lead overlay edge vs a reporting edge. */
  isOverlay: boolean;
};
