import type { ApiClient } from './client';
import type {
  Asset, AssetCategory, AssetStatus, AuditEntry, BlastRadius, ChainIntegrity, DiscoveredItem, DiscoveredItemStatus, Entitlement, LedgerEntry,
  ApprovalPolicy, ApprovalRequest, ApprovalStage, ApprovalStatus, CatalogField, CatalogItem, CatalogItemStatus, Incident, IncidentImpact, IncidentPriority, IncidentStatus, Plan, PlanStatus, RequestStatus, ServiceRequest, Subscription,
  StockEntry, StockItem, StockStatus,
  TopologyEdge, TopologyNode, TraversalDirection,
} from './types';

const ASSETS = '/it-asset-registry/v1';
const DISCOVERY = '/it-discovery/v1';
const TOPOLOGY = '/it-topology-graph/v1';
const AUTH = '/party-authentication/v1';
const LEDGER = '/compliance-audit-ledger/v1';
const BILLING = '/subscription-billing/v1';
const STOCK = '/consumable-inventory/v1';
const APPROVALS = '/workflow-approval/v1';
const INCIDENTS = '/it-incident-management/v1';
const REQUESTS = '/it-service-request/v1';

export type AssetAction = 'ready' | 'deploy' | 'maintenance' | 'decommission';

/** The Asset FSM (mirrors Asset.AssetStatus.canTransitionTo); the API stays the authority, this only hides illegal buttons. */
export const ASSET_ACTIONS: Record<AssetStatus, { action: AssetAction; label: string }[]> = {
  PROVISIONED: [{ action: 'ready', label: 'Mark ready' }, { action: 'decommission', label: 'Decommission' }],
  READY: [{ action: 'deploy', label: 'Deploy' }, { action: 'decommission', label: 'Decommission' }],
  DEPLOYED: [
    { action: 'maintenance', label: 'Start maintenance' },
    { action: 'ready', label: 'Return to ready' },
    { action: 'decommission', label: 'Decommission' },
  ],
  MAINTENANCE: [
    { action: 'deploy', label: 'Redeploy' },
    { action: 'ready', label: 'Return to ready' },
    { action: 'decommission', label: 'Decommission' },
  ],
  DECOMMISSIONED: [],
};

export interface SessionTokens {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken: string;
}

export const authApi = (api: ApiClient) => ({
  signIn: (organisationId: string, email: string, password: string) =>
    api.post<SessionTokens>(`${AUTH}/session/initiate`, { organisationId, email, password }),
});

export const assetApi = (api: ApiClient) => ({
  create: (body: { name: string; category: AssetCategory; serialNumber: string; specifications: Record<string, string> }) =>
    api.post<Asset>(`${ASSETS}/initiate`, body),
  list: (filter: { status?: AssetStatus; category?: AssetCategory }) => api.get<Asset[]>(`${ASSETS}/retrieve`, filter),
  retrieve: (id: string) => api.get<Asset>(`${ASSETS}/${id}/retrieve`),
  auditLog: (id: string) => api.get<AuditEntry[]>(`${ASSETS}/${id}/audit-log/retrieve`),
  control: (id: string, action: AssetAction) => api.put(`${ASSETS}/${id}/control/${action}`),
});

export const discoveryApi = (api: ApiClient) => ({
  list: (filter: { status?: DiscoveredItemStatus; source?: string; category?: AssetCategory }) =>
    api.get<DiscoveredItem[]>(`${DISCOVERY}/retrieve`, filter),
  claim: (id: string) => api.put(`${DISCOVERY}/${id}/review/claim`),
  reviewUpdate: (id: string, update: { suggestedCategory?: AssetCategory; matchedAssetId?: string }) =>
    api.put(`${DISCOVERY}/${id}/review/update`, update),
  ignore: (id: string) => api.put(`${DISCOVERY}/${id}/control/ignore`),
  promote: (id: string) => api.put<DiscoveredItem>(`${DISCOVERY}/${id}/control/promote`),
});

export const topologyApi = (api: ApiClient) => ({
  nodes: (filter: { nodeType?: string; status?: string } = {}) => api.get<TopologyNode[]>(`${TOPOLOGY}/retrieve`, filter),
  edges: (filter: { relationshipType?: string; nodeId?: string; status?: string } = {}) =>
    api.get<TopologyEdge[]>(`${TOPOLOGY}/edge/retrieve`, filter),
  blastRadius: (nodeId: string, direction: TraversalDirection, maxHops: number) =>
    api.get<BlastRadius>(`${TOPOLOGY}/${nodeId}/blast-radius/retrieve`, { direction, maxHops }),
});

export const ledgerApi = (api: ApiClient) => ({
  list: (filter: { actor?: string; resourceType?: string; resourceId?: string; limit?: number }) =>
    api.get<LedgerEntry[]>(`${LEDGER}/retrieve`, filter),
  verify: () => api.get<ChainIntegrity>(`${LEDGER}/integrity-check/evaluate`),
});

export const billingApi = (api: ApiClient) => ({
  current: () => api.get<Subscription>(`${BILLING}/current/retrieve`),
  plans: (status?: PlanStatus) => api.get<Plan[]>(`${BILLING}/plan/retrieve`, { status }),
  evaluate: (feature: string) => api.get<Entitlement>(`${BILLING}/entitlement/evaluate`, { feature }),
});

export type StockMovement = 'receive' | 'issue' | 'adjust';

export const stockApi = (api: ApiClient) => ({
  list: (status?: StockStatus) => api.get<StockItem[]>(`${STOCK}/retrieve`, { status }),
  lowStock: () => api.get<StockItem[]>(`${STOCK}/low-stock/retrieve`),
  retrieve: (id: string) => api.get<StockItem>(`${STOCK}/${id}/retrieve`),
  history: (id: string) => api.get<StockEntry[]>(`${STOCK}/${id}/history/retrieve`),
  create: (body: { sku: string; name: string; unit: string; reorderLevel: number; initialQuantity: number }) =>
    api.post<StockItem>(`${STOCK}/initiate`, body),
  receive: (id: string, quantity: number, reason?: string) => api.put(`${STOCK}/${id}/movement/receive`, { quantity, reason }),
  issue: (id: string, quantity: number, reason?: string) => api.put(`${STOCK}/${id}/movement/issue`, { quantity, reason }),
  adjust: (id: string, newQuantity: number, reason: string) => api.put(`${STOCK}/${id}/movement/adjust`, { newQuantity, reason }),
  discontinue: (id: string) => api.put(`${STOCK}/${id}/control/discontinue`),
});

export interface RefreshedSession {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

/** The gateway's own session endpoints: the refresh token lives in an HttpOnly cookie, so these take no token from the page (gateway ADR-025). */
export const sessionApi = (api: ApiClient) => ({
  refresh: () => api.post<RefreshedSession>('/gateway/v1/session/refresh', undefined, { headers: { 'X-Requested-With': 'thinklab-web' } }),
  logout: () => api.post<void>('/gateway/v1/session/logout', undefined, { headers: { 'X-Requested-With': 'thinklab-web' } }),
});

/** Where a federated sign-in starts: the browser is sent to the organisation's identity provider and comes back through the gateway. */
export const ssoLoginUrl = (organisationId: string) => `/api/identity-federation/v1/login/initiate?organisationId=${encodeURIComponent(organisationId)}`;

export const approvalApi = (api: ApiClient) => ({
  policies: () => api.get<ApprovalPolicy[]>(`${APPROVALS}/policy/retrieve`),
  /** A chain is its stages, in order; a person can belong to only one stage. */
  createPolicy: (name: string, stages: ApprovalStage[]) => api.post<ApprovalPolicy>(`${APPROVALS}/policy/initiate`, { name, stages }),
  requests: (status?: ApprovalStatus) => api.get<ApprovalRequest[]>(`${APPROVALS}/retrieve`, { status }),
  /** The approver inbox: what this approver can decide now, oldest first. */
  inbox: (approverId: string) => api.get<ApprovalRequest[]>(`${APPROVALS}/retrieve`, { pendingFor: approverId }),
  /** The decision is cast by the signed-in executor (the X-Executor header), who must be a user id. */
  decide: (id: string, outcome: 'APPROVE' | 'REJECT', comment?: string) =>
    api.put<ApprovalRequest>(`${APPROVALS}/${id}/decision/capture`, { outcome, comment: comment || undefined }),
  cancel: (id: string) => api.put(`${APPROVALS}/${id}/control/cancel`),
  auditLog: (id: string) => api.get<AuditEntry[]>(`${APPROVALS}/${id}/audit-log/retrieve`),
});

export type IncidentAction = 'acknowledge' | 'start' | 'resume' | 'close' | 'cancel';

/** What a person can do next with an incident in each status (mirrors Incident's lifecycle; the API stays the authority). */
export const INCIDENT_ACTIONS: Record<IncidentStatus, { action: IncidentAction; label: string }[]> = {
  NEW: [{ action: 'acknowledge', label: 'Acknowledge' }, { action: 'cancel', label: 'Cancel' }],
  ACKNOWLEDGED: [{ action: 'start', label: 'Start work' }, { action: 'cancel', label: 'Cancel' }],
  IN_PROGRESS: [{ action: 'cancel', label: 'Cancel' }],
  ON_HOLD: [{ action: 'resume', label: 'Resume' }, { action: 'cancel', label: 'Cancel' }],
  RESOLVED: [{ action: 'close', label: 'Close' }],
  CLOSED: [],
  CANCELLED: [],
};

export interface IncidentInput {
  title: string;
  description: string;
  impact: IncidentImpact;
  urgency: IncidentImpact;
  affectedAssetIds?: string[];
  relatedChangeIds?: string[];
}

export const incidentApi = (api: ApiClient) => ({
  list: (filter: { status?: IncidentStatus; priority?: IncidentPriority; assigneeId?: string; openOnly?: boolean }) =>
    api.get<Incident[]>(`${INCIDENTS}/retrieve`, { status: filter.status, priority: filter.priority, assigneeId: filter.assigneeId, openOnly: filter.openOnly ? 'true' : undefined }),
  retrieve: (id: string) => api.get<Incident>(`${INCIDENTS}/${id}/retrieve`),
  /** The priority is not sent: the service derives it from impact and urgency. */
  create: (body: IncidentInput & { requesterId?: string }) => api.post<Incident>(`${INCIDENTS}/initiate`, body),
  update: (id: string, body: IncidentInput) => api.put(`${INCIDENTS}/${id}/update`, body),
  assign: (id: string, assigneeId: string) => api.put(`${INCIDENTS}/${id}/assignment/update`, { assigneeId }),
  control: (id: string, action: IncidentAction) => api.put(`${INCIDENTS}/${id}/control/${action}`),
  hold: (id: string, reason: string) => api.put(`${INCIDENTS}/${id}/control/hold`, { reason }),
  resolve: (id: string, resolutionCode: string, notes: string) => api.put(`${INCIDENTS}/${id}/control/resolve`, { resolutionCode, notes }),
  reopen: (id: string, reason: string) => api.put(`${INCIDENTS}/${id}/control/reopen`, { reason }),
  comment: (id: string, text: string, internal: boolean) => api.post(`${INCIDENTS}/${id}/comment/initiate`, { text, internal }),
  auditLog: (id: string) => api.get<AuditEntry[]>(`${INCIDENTS}/${id}/audit-log/retrieve`),
});

export type RequestAction = 'start-fulfilment' | 'close' | 'cancel';

/** What a person can do next with a request in each status (mirrors ServiceRequest's lifecycle; the API stays the authority). Fulfil and the approval decision have their own forms. */
export const REQUEST_ACTIONS: Record<RequestStatus, { action: RequestAction; label: string }[]> = {
  SUBMITTED: [{ action: 'start-fulfilment', label: 'Start fulfilment' }, { action: 'cancel', label: 'Cancel' }],
  PENDING_APPROVAL: [{ action: 'cancel', label: 'Cancel' }],
  APPROVED: [{ action: 'start-fulfilment', label: 'Start fulfilment' }, { action: 'cancel', label: 'Cancel' }],
  REJECTED: [],
  IN_FULFILMENT: [{ action: 'cancel', label: 'Cancel' }],
  FULFILLED: [{ action: 'close', label: 'Close' }],
  CLOSED: [],
  CANCELLED: [],
};

export interface CatalogItemInput {
  code?: string;
  name: string;
  description?: string;
  category?: string;
  fields: CatalogField[];
  fulfilmentTargetHours: number;
  approvalPolicyId?: string;
}

export const serviceRequestApi = (api: ApiClient) => ({
  catalog: {
    list: (status?: CatalogItemStatus) => api.get<CatalogItem[]>(`${REQUESTS}/catalog/retrieve`, { status }),
    create: (body: CatalogItemInput) => api.post<CatalogItem>(`${REQUESTS}/catalog/initiate`, body),
    update: (id: string, body: CatalogItemInput) => api.put(`${REQUESTS}/catalog/${id}/update`, body),
    control: (id: string, action: 'publish' | 'retire') => api.put(`${REQUESTS}/catalog/${id}/control/${action}`),
  },
  list: (filter: { status?: RequestStatus; assigneeId?: string; openOnly?: boolean }) =>
    api.get<ServiceRequest[]>(`${REQUESTS}/retrieve`, { status: filter.status, assigneeId: filter.assigneeId, openOnly: filter.openOnly ? 'true' : undefined }),
  retrieve: (id: string) => api.get<ServiceRequest>(`${REQUESTS}/${id}/retrieve`),
  create: (body: { catalogItemId: string; answers: Record<string, string>; requesterId?: string }) => api.post<ServiceRequest>(`${REQUESTS}/initiate`, body),
  assign: (id: string, assigneeId: string) => api.put(`${REQUESTS}/${id}/assignment/update`, { assigneeId }),
  /** The decision is cast by the signed-in executor (the X-Executor header), who must be a user id. */
  decide: (id: string, outcome: 'APPROVE' | 'REJECT', comment?: string) =>
    api.put<ServiceRequest>(`${REQUESTS}/${id}/approval/capture`, { outcome, comment: comment || undefined }),
  control: (id: string, action: RequestAction) => api.put(`${REQUESTS}/${id}/control/${action}`),
  fulfil: (id: string, notes: string) => api.put(`${REQUESTS}/${id}/control/fulfil`, { notes }),
  comment: (id: string, text: string, internal: boolean) => api.post(`${REQUESTS}/${id}/comment/initiate`, { text, internal }),
  auditLog: (id: string) => api.get<AuditEntry[]>(`${REQUESTS}/${id}/audit-log/retrieve`),
});
