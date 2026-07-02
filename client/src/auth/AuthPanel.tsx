import { useEffect, useState } from 'react';
import type { Action, AuthState } from './auth';
import { ALL_ACTIONS } from './auth';

const ACTION_LABELS: Record<Action, string> = {
  'approval:read': 'чтение',
  'approval:create': 'создание',
  'approval:decide': 'решение',
  'approval:cancel': 'отмена',
};

interface Props {
  auth: AuthState;
  onChange: (auth: AuthState) => void;
}

export function AuthPanel({ auth, onChange }: Props) {
  const [draft, setDraft] = useState<AuthState>(auth);

  useEffect(() => {
    setDraft(auth);
  }, [auth]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(auth);

  function toggleAction(action: Action) {
    setDraft((prev) => ({
      ...prev,
      actions: ALL_ACTIONS.filter((candidate) =>
        candidate === action
          ? !prev.actions.includes(action)
          : prev.actions.includes(candidate),
      ),
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const userId = draft.userId.trim();
    const workspaceId = draft.workspaceId.trim();
    if (!userId || !workspaceId) return;
    onChange({ ...draft, userId, workspaceId });
  }

  return (
    <form className="auth-panel" onSubmit={submit}>
      <label>
        Пользователь
        <input
          type="text"
          value={draft.userId}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, userId: event.target.value }))
          }
          required
        />
      </label>
      <label>
        Workspace
        <input
          type="text"
          value={draft.workspaceId}
          onChange={(event) =>
            setDraft((prev) => ({ ...prev, workspaceId: event.target.value }))
          }
          required
        />
      </label>
      <fieldset className="auth-actions">
        <legend>Права</legend>
        {ALL_ACTIONS.map((action) => (
          <label key={action}>
            <input
              type="checkbox"
              checked={draft.actions.includes(action)}
              onChange={() => toggleAction(action)}
            />
            {ACTION_LABELS[action]}
          </label>
        ))}
      </fieldset>
      <button type="submit" className="btn btn-primary" disabled={!dirty}>
        Применить
      </button>
    </form>
  );
}
