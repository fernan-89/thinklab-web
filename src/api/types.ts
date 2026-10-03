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
