// Mirrors the gateway's response DTOs (records of the Micronaut services). Fields the API omits when null are optional.

export const ASSET_CATEGORIES = [
  'LAPTOP', 'DESKTOP', 'SERVER', 'NETWORK_DEVICE', 'STORAGE_ARRAY', 'PERIPHERAL', 'MOBILE_DEVICE', 'IOT_SENSOR', 'VIRTUAL_MACHINE', 'SOFTWARE_LICENSE',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export type AssetStatus = 'PROVISIONED' | 'READY' | 'DEPLOYED' | 'MAINTENANCE' | 'DECOMMISSIONED';
export const ASSET_STATUSES: AssetStatus[] = ['PROVISIONED', 'READY', 'DEPLOYED', 'MAINTENANCE', 'DECOMMISSIONED'];

export interface Asset {
  id: string;
  organisationId: string;
  name: string;
  category: AssetCategory;
  serialNumber: string;
  specifications?: Record<string, string>;
  status: AssetStatus;
  assignedToUserId?: string;
  locationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  occurredAt: string;
  action: string;
  executor: string;
  fromStatus?: string;
  toStatus?: string;
  detail?: string;
}

export type DiscoveredItemStatus = 'DISCOVERED' | 'UNDER_REVIEW' | 'PROMOTED' | 'IGNORED';
export const DISCOVERED_ITEM_STATUSES: DiscoveredItemStatus[] = ['DISCOVERED', 'UNDER_REVIEW', 'PROMOTED', 'IGNORED'];

export interface DiscoveredItem {
  id: string;
  organisationId: string;
  source: string;
  externalKey: string;
  name: string;
  suggestedCategory?: AssetCategory;
  rawAttributes?: Record<string, string>;
  matchedAssetId?: string;
  promotedAssetId?: string;
  status: DiscoveredItemStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopologyNode {
  id: string;
  organisationId: string;
  nodeType: string;
  externalId: string;
  label: string;
  attributes?: Record<string, string>;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  updatedAt: string;
}

export interface TopologyEdge {
  id: string;
  organisationId: string;
  relationshipType: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: 'ACTIVE' | 'RETIRED';
  createdAt: string;
  updatedAt: string;
}

export type TraversalDirection = 'DOWNSTREAM' | 'UPSTREAM' | 'BOTH';

export interface ImpactedNode {
  nodeId: string;
  nodeType: string;
  externalId: string;
  label: string;
  hops: number;
  direction: TraversalDirection;
}

export interface BlastRadius {
  nodeId: string;
  maxHops: number;
  direction: TraversalDirection;
  impactedNodes: ImpactedNode[];
}

export interface LedgerEntry {
  id: string;
  organisationId: string;
  sequence: number;
  occurredAt: string;
  recordedAt: string;
  source: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  detail?: string;
  recordedBy: string;
  previousHash: string;
  hash: string;
}

export interface ChainIntegrity {
  valid: boolean;
  entriesChecked: number;
  headSequence: number;
  headHash?: string;
  firstBrokenSequence?: number;
  reason?: string;
  /** How many anchors published outside the database the chain was confirmed against. */
  anchorsVerified: number;
}

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';
export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface Subscription {
  id: string;
  organisationId: string;
  planCode: string;
  status: SubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  /** feature -> limit: -1 unlimited, 0 not included, a positive number is the allowed quantity. */
  entitlements: Record<string, number>;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

/** Where an entitlement answer came from: the organisation's own plan, the default plan, a suspension, or nothing configured (allowed). */
export type EntitlementSource = 'SUBSCRIPTION' | 'DEFAULT_PLAN' | 'SUSPENDED' | 'UNMANAGED';

export interface Entitlement {
  feature: string;
  allowed: boolean;
  /** The allowed quantity; absent when unlimited or not allowed. */
  limit?: number;
  source: EntitlementSource;
  planCode?: string;
}

export type StockStatus = 'ACTIVE' | 'DISCONTINUED';

export interface StockItem {
  id: string;
  organisationId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reorderLevel: number;
  /** True when the quantity on hand is at or under the reorder level. */
  belowReorderLevel: boolean;
  status: StockStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StockEntry {
  occurredAt: string;
  action: string;
  executor: string;
  /** The signed change to the quantity on hand (0 for entries that do not move stock). */
  quantity: number;
  balanceAfter: number;
  reason?: string;
}

// ---- Approvals (workflow-approval-service, ADR-033/034) ----

export interface ApprovalStage {
  requiredApprovals: number;
  eligibleApproverIds: string[];
}

export interface ApprovalPolicy {
  id: string;
  organisationId: string;
  name: string;
  /** The first stage (the whole quorum of a one-stage policy). */
  requiredApprovals: number;
  eligibleApproverIds: string[];
  stages: ApprovalStage[];
  createdAt: string;
  updatedAt: string;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export const APPROVAL_STATUSES: ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export interface ApprovalDecision {
  approverId: string;
  outcome: 'APPROVE' | 'REJECT';
  comment?: string;
  decidedAt: string;
  /** One-based. */
  stage: number;
}

export interface ApprovalRequest {
  id: string;
  organisationId: string;
  subjectType: string;
  subjectId: string;
  requesterId: string;
  policyId: string;
  /** The stage the request is waiting on now. */
  requiredApprovals: number;
  eligibleApproverIds: string[];
  /** One-based. */
  currentStage: number;
  stages: ApprovalStage[];
  status: ApprovalStatus;
  decisions: ApprovalDecision[];
  createdAt: string;
  updatedAt: string;
}

// ---- Incidents (it-incident-management-service, ADR-030..033) ----

export type IncidentImpact = 'LOW' | 'MEDIUM' | 'HIGH';
export const INCIDENT_LEVELS: IncidentImpact[] = ['LOW', 'MEDIUM', 'HIGH'];
export type IncidentPriority = 'P1' | 'P2' | 'P3' | 'P4';
export const INCIDENT_PRIORITIES: IncidentPriority[] = ['P1', 'P2', 'P3', 'P4'];
export type IncidentStatus = 'NEW' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';
export const INCIDENT_STATUSES: IncidentStatus[] = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'CANCELLED'];

/** One SLA target: still running, met, or breached - worked out by the service when it is read. */
export interface IncidentSla {
  dueAt: string;
  state: 'PENDING' | 'MET' | 'BREACHED';
}

export interface IncidentComment {
  commentId: string;
  author: string;
  text: string;
  internal: boolean;
  createdAt: string;
}

export interface Incident {
  id: string;
  organisationId: string;
  requesterId: string;
  title: string;
  description: string;
  impact: IncidentImpact;
  urgency: IncidentImpact;
  priority: IncidentPriority;
  status: IncidentStatus;
  assigneeId?: string;
  affectedAssetIds: string[];
  relatedChangeIds: string[];
  holdReason?: string;
  resolutionCode?: string;
  resolutionNotes?: string;
  reopenCount: number;
  /** Absent for a cancelled incident, which has no SLA to meet. */
  response?: IncidentSla;
  resolution?: IncidentSla;
  acknowledgedAt?: string;
  resolvedAt?: string;
  comments: IncidentComment[];
  createdAt: string;
  updatedAt: string;
}
