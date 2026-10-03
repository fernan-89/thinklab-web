import type { ApiClient } from './client';
import type {
  Asset, AssetCategory, AssetStatus, AuditEntry, BlastRadius, ChainIntegrity, DiscoveredItem, DiscoveredItemStatus, Entitlement, LedgerEntry,
  ApprovalPolicy, ApprovalRequest, ApprovalStage, ApprovalStatus, Plan, PlanStatus, Subscription,
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
