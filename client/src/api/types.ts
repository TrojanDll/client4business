export const SOURCE_TYPES = [
  'publication',
  'scenario',
  'edit',
  'external',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const STATUSES = ['pending', 'approved', 'rejected', 'canceled'] as const;
export type ApprovalStatus = (typeof STATUSES)[number];

export interface ApprovalRequestView {
  id: string;
  workspaceId: string;
  sourceType: SourceType;
  sourceId: string;
  title: string;
  description: string | null;
  status: ApprovalStatus;
  reviewerUserIds: string[];
  createdByUserId: string;
  decidedByUserId: string | null;
  decisionComment: string | null;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface AuditEntryView {
  id: string;
  actorUserId: string;
  action: string;
  details: unknown;
  createdAt: string;
}

export interface ApprovalRequestDetailView extends ApprovalRequestView {
  history: AuditEntryView[];
}

export interface ApprovalRequestListView {
  items: ApprovalRequestView[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateApprovalRequestInput {
  sourceType: SourceType;
  sourceId: string;
  title: string;
  description?: string;
  reviewerUserIds: string[];
}
