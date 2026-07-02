import type { AuthState } from '../auth/auth';
import type {
  ApprovalRequestDetailView,
  ApprovalRequestListView,
  ApprovalRequestView,
  ApprovalStatus,
  CreateApprovalRequestInput,
  SourceType,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  constructor() {
    super('Network request failed');
  }
}

export interface ListParams {
  status: ApprovalStatus | '';
  sourceType: SourceType | '';
  limit: number;
  offset: number;
}

function basePath(auth: AuthState): string {
  return `/api/v1/workspaces/${encodeURIComponent(auth.workspaceId)}/approval-requests`;
}

async function request<T>(
  auth: AuthState,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'X-User-Id': auth.userId,
    'X-Workspace-Id': auth.workspaceId,
    'X-Actions': auth.actions.join(','),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? response.statusText,
    );
  }
  return payload as T;
}

export const api = {
  list(auth: AuthState, params: ListParams): Promise<ApprovalRequestListView> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.sourceType) query.set('sourceType', params.sourceType);
    query.set('limit', String(params.limit));
    query.set('offset', String(params.offset));
    return request(auth, 'GET', `${basePath(auth)}?${query.toString()}`);
  },

  get(auth: AuthState, id: string): Promise<ApprovalRequestDetailView> {
    return request(auth, 'GET', `${basePath(auth)}/${id}`);
  },

  create(
    auth: AuthState,
    input: CreateApprovalRequestInput,
    key: string,
  ): Promise<ApprovalRequestView> {
    return request(auth, 'POST', basePath(auth), input, key);
  },

  approve(
    auth: AuthState,
    id: string,
    comment: string,
    key: string,
  ): Promise<ApprovalRequestView> {
    return request(
      auth,
      'POST',
      `${basePath(auth)}/${id}/approve`,
      comment ? { comment } : {},
      key,
    );
  },

  reject(
    auth: AuthState,
    id: string,
    reason: string,
    key: string,
  ): Promise<ApprovalRequestView> {
    return request(auth, 'POST', `${basePath(auth)}/${id}/reject`, { reason }, key);
  },

  cancel(
    auth: AuthState,
    id: string,
    reason: string,
    key: string,
  ): Promise<ApprovalRequestView> {
    return request(
      auth,
      'POST',
      `${basePath(auth)}/${id}/cancel`,
      reason ? { reason } : {},
      key,
    );
  },
};
