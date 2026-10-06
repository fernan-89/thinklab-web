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

// ---- Service catalog and requests (it-service-request-service, ADR-030..034) ----

export type CatalogItemStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';
export const CATALOG_STATUSES: CatalogItemStatus[] = ['DRAFT', 'PUBLISHED', 'RETIRED'];

/** One question a requester answers when ordering the item. */
export interface CatalogField {
  key: string;
  label: string;
  required: boolean;
}

export interface CatalogItem {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  category?: string;
  fields: CatalogField[];
  fulfilmentTargetHours: number;
  /** Present when the item needs approval first (a policy on workflow-approval, possibly a chain). */
  approvalPolicyId?: string;
  status: CatalogItemStatus;
  createdAt: string;
  updatedAt: string;
}

export type RequestStatus = 'SUBMITTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'IN_FULFILMENT' | 'FULFILLED' | 'CLOSED' | 'CANCELLED';
export const REQUEST_STATUSES: RequestStatus[] = ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'IN_FULFILMENT', 'FULFILLED', 'CLOSED', 'CANCELLED'];

/** The fulfilment target: still running, met, or breached - worked out by the service when it is read. */
export interface RequestSla {
  dueAt: string;
  state: 'PENDING' | 'MET' | 'BREACHED';
}

export type RequestComment = IncidentComment;

export interface ServiceRequest {
  id: string;
  organisationId: string;
  requesterId: string;
  catalogItemId: string;
  catalogItemCode: string;
  catalogItemName: string;
  answers: Record<string, string>;
  status: RequestStatus;
  assigneeId?: string;
  approvalRequestId?: string;
  /** Absent for a cancelled or rejected request, which owes no SLA. */
  fulfilment?: RequestSla;
  startedAt?: string;
  fulfilledAt?: string;
  /** What an approver asked to fix, while the request is RETURNED. */
  returnReason?: string;
  fulfilmentNotes?: string;
  comments: RequestComment[];
  createdAt: string;
  updatedAt: string;
}

// ---- Problems (it-problem-management-service, ADR-030..033) ----

export type ProblemPriority = 'P1' | 'P2' | 'P3' | 'P4';
export const PROBLEM_PRIORITIES: ProblemPriority[] = ['P1', 'P2', 'P3', 'P4'];
export type ProblemStatus = 'NEW' | 'UNDER_INVESTIGATION' | 'KNOWN_ERROR' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';
export const PROBLEM_STATUSES: ProblemStatus[] = ['NEW', 'UNDER_INVESTIGATION', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED', 'CANCELLED'];

export interface ProblemComment {
  commentId: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface Problem {
  id: string;
  organisationId: string;
  title: string;
  description: string;
  priority: ProblemPriority;
  status: ProblemStatus;
  assigneeId?: string;
  relatedIncidentIds: string[];
  relatedChangeIds: string[];
  affectedAssetIds: string[];
  rootCause?: string;
  workaround?: string;
  resolution?: string;
  reopenCount: number;
  comments: ProblemComment[];
  createdAt: string;
  updatedAt: string;
}

// ---- Knowledge base (it-knowledge-base-service, ADR-030..033) ----

export type ArticleStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'RETIRED';
export const ARTICLE_STATUSES: ArticleStatus[] = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED'];
export type ArticleVisibility = 'INTERNAL' | 'PUBLIC';
export const ARTICLE_VISIBILITIES: ArticleVisibility[] = ['INTERNAL', 'PUBLIC'];

/** An article as read. For a REQUESTER the people, the review comment and the links are absent. */
export interface Article {
  id: string;
  organisationId: string;
  /** Shared by every version of the same article. */
  articleKey: string;
  version: number;
  title: string;
  body: string;
  category?: string;
  keywords: string[];
  visibility: ArticleVisibility;
  status: ArticleStatus;
  authorId?: string;
  reviewerId?: string;
  /** What the reviewer asked to change, while the article is back in DRAFT. */
  reviewComment?: string;
  publishedAt?: string;
  relatedProblemIds?: string[];
  relatedIncidentIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- External ticketing (it-external-ticketing-service, ADR-030..033) ----

export type ConnectionProvider = 'JIRA' | 'SERVICENOW';
export const CONNECTION_PROVIDERS: ConnectionProvider[] = ['JIRA', 'SERVICENOW'];
export type ConnectionStatus = 'ACTIVE' | 'DISABLED';

/** A registered ServiceNow or Jira instance. It names the environment variables that hold its secrets and never carries a secret. */
export interface Connection {
  id: string;
  organisationId: string;
  name: string;
  provider: ConnectionProvider;
  baseUrl: string;
  secretRef: string;
  secretConfigured: boolean;
  webhookSecretRef: string;
  webhookSecretConfigured: boolean;
  integrationActor: string;
  projectKey?: string;
  outboundStatus: Record<string, string>;
  inboundActions: Record<string, string>;
  status: ConnectionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionCheck {
  secretConfigured: boolean;
  webhookSecretConfigured: boolean;
  reachable: boolean;
  problem?: string;
}

export type LinkStatus = 'PENDING' | 'LINKED' | 'FAILED' | 'DETACHED';
export const LINK_STATUSES: LinkStatus[] = ['PENDING', 'LINKED', 'FAILED', 'DETACHED'];
export type LinkSubjectType = 'INCIDENT' | 'SERVICE_REQUEST' | 'PROBLEM';
export const LINK_SUBJECT_TYPES: LinkSubjectType[] = ['INCIDENT', 'SERVICE_REQUEST', 'PROBLEM'];

/** The pairing of a platform item with a ticket at a provider. Only ids, statuses and times: never the ticket text. */
export interface TicketLink {
  id: string;
  organisationId: string;
  connectionId: string;
  subjectType: LinkSubjectType;
  subjectId: string;
  externalId?: string;
  externalUrl?: string;
  status: LinkStatus;
  lastPushedStatus?: string;
  syncedComments: number;
  lastSyncedAt?: string;
  lastDirection?: 'OUTBOUND' | 'INBOUND';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Health monitoring (it-health-monitoring-service, ADR-030..033) ----

export type CheckType = 'HTTP' | 'TCP';
export const CHECK_TYPES: CheckType[] = ['HTTP', 'TCP'];
export type CheckStatus = 'ACTIVE' | 'PAUSED';
export const CHECK_STATUSES: CheckStatus[] = ['ACTIVE', 'PAUSED'];
export type Health = 'UNKNOWN' | 'UP' | 'DOWN';
export const HEALTHS: Health[] = ['UNKNOWN', 'UP', 'DOWN'];

export interface HealthCheck {
  id: string;
  organisationId: string;
  name: string;
  type: CheckType;
  target: string;
  assetId?: string;
  intervalSeconds: number;
  timeoutMillis: number;
  expectedStatus?: number;
  failureThreshold: number;
  successThreshold: number;
  status: CheckStatus;
  health: Health;
  consecutiveFailures: number;
  lastCheckedAt?: string;
  lastLatencyMillis?: number;
  /** One of a fixed vocabulary (timeout, connection refused, dns failure, unexpected status, address not allowed, probe failed): never text from the target. */
  lastError?: string;
  lastStateChangeAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProbeResult {
  at: string;
  ok: boolean;
  statusCode?: number;
  latencyMillis: number;
  error?: string;
}

export interface HealthSummary {
  total: number;
  up: number;
  down: number;
  unknown: number;
  paused: number;
}

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH'];
export type RuleStatus = 'ACTIVE' | 'PAUSED';
export type AlertStatus = 'OPEN' | 'RESOLVED';
export const ALERT_STATUSES: AlertStatus[] = ['OPEN', 'RESOLVED'];

export interface AlertRule {
  id: string;
  organisationId: string;
  name: string;
  /** Left out: the rule covers every check of the tenant. */
  checkId?: string;
  impact: Severity;
  urgency: Severity;
  requesterId: string;
  status: RuleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  name: string;
  checkId?: string;
  impact: Severity;
  urgency: Severity;
  requesterId: string;
}

/** One outage of one check. Opened and resolved by the evaluation, never by hand. */
export interface Alert {
  id: string;
  organisationId: string;
  ruleId: string;
  checkId: string;
  checkName: string;
  assetId?: string;
  status: AlertStatus;
  openedAt: string;
  resolvedAt?: string;
  incidentId?: string;
  lastError?: string;
  /** Why the incident is not there yet (a short fixed line); the next round retries. */
  problem?: string;
  updatedAt: string;
}

export interface Evaluation {
  opened: number;
  resolved: number;
  incidentsOpened: number;
}
