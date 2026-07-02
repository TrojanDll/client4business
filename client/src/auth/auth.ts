export const ALL_ACTIONS = [
  'approval:read',
  'approval:create',
  'approval:decide',
  'approval:cancel',
] as const;
export type Action = (typeof ALL_ACTIONS)[number];

export interface AuthState {
  userId: string;
  workspaceId: string;
  actions: Action[];
}

const STORAGE_KEY = 'approval-service-auth';

const DEFAULT_AUTH: AuthState = {
  userId: 'usr_1',
  workspaceId: 'ws_1',
  actions: [...ALL_ACTIONS],
};

export function loadAuth(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTH;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.workspaceId !== 'string' ||
      !Array.isArray(parsed.actions)
    ) {
      return DEFAULT_AUTH;
    }
    const actions = parsed.actions as string[];
    return {
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      actions: ALL_ACTIONS.filter((action) => actions.includes(action)),
    };
  } catch {
    return DEFAULT_AUTH;
  }
}

export function saveAuth(auth: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function hasAction(auth: AuthState, action: Action): boolean {
  return auth.actions.includes(action);
}
