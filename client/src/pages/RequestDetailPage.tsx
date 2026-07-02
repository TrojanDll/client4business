import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import type { ApprovalRequestDetailView, AuditEntryView } from '../api/types';
import type { AuthState } from '../auth/auth';
import { hasAction } from '../auth/auth';
import { StatusBadge } from '../components/StatusBadge';
import {
  AUDIT_ACTION_LABELS,
  SOURCE_TYPE_LABELS,
  errorMessage,
  formatDate,
} from '../lib/format';
import { useIdempotentAction } from '../lib/use-idempotent-action';

type DecisionKind = 'approve' | 'reject' | 'cancel';

const DECISION_FORMS: Record<
  DecisionKind,
  { title: string; field: string; requiresText: boolean }
> = {
  approve: {
    title: 'Согласовать заявку',
    field: 'Комментарий (необязательно)',
    requiresText: false,
  },
  reject: {
    title: 'Отклонить заявку',
    field: 'Причина отклонения (обязательно)',
    requiresText: true,
  },
  cancel: {
    title: 'Отменить заявку',
    field: 'Причина отмены (необязательно)',
    requiresText: false,
  },
};

function auditDetailsText(entry: AuditEntryView): string | null {
  const details = entry.details as { comment?: unknown; reason?: unknown } | null;
  if (details && typeof details.comment === 'string' && details.comment) {
    return `Комментарий: ${details.comment}`;
  }
  if (details && typeof details.reason === 'string' && details.reason) {
    return `Причина: ${details.reason}`;
  }
  return null;
}

interface Props {
  auth: AuthState;
  requestId: string;
}

export function RequestDetailPage({ auth, requestId }: Props) {
  const [detail, setDetail] = useState<ApprovalRequestDetailView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<DecisionKind | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const runApprove = useIdempotentAction();
  const runReject = useIdempotentAction();
  const runCancel = useIdempotentAction();

  const load = useCallback(() => {
    return api
      .get(auth, requestId)
      .then((result) => {
        setDetail(result);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        setDetail(null);
        setLoadError(errorMessage(cause));
      });
  }, [auth, requestId]);

  useEffect(() => {
    setOpenForm(null);
    setActionError(null);
    void load();
  }, [load]);

  function submitDecision(kind: DecisionKind) {
    const value = text.trim();
    if (DECISION_FORMS[kind].requiresText && !value) {
      setActionError('Укажите причину отклонения.');
      return;
    }
    const run = { approve: runApprove, reject: runReject, cancel: runCancel }[kind];
    setSubmitting(true);
    setActionError(null);
    run((key) => {
      if (kind === 'approve') return api.approve(auth, requestId, value, key);
      if (kind === 'reject') return api.reject(auth, requestId, value, key);
      return api.cancel(auth, requestId, value, key);
    })
      .then(() => {
        setOpenForm(null);
        setText('');
        return load();
      })
      .catch((cause: unknown) => {
        setActionError(errorMessage(cause));
        if (cause instanceof ApiError && cause.status === 409) void load();
      })
      .finally(() => setSubmitting(false));
  }

  if (loadError) {
    return (
      <section>
        <a className="back-link" href="#/">
          ← К списку
        </a>
        <div className="alert alert-error">{loadError}</div>
      </section>
    );
  }

  if (!detail) {
    return (
      <section>
        <a className="back-link" href="#/">
          ← К списку
        </a>
        <p className="muted">Загрузка…</p>
      </section>
    );
  }

  const isPending = detail.status === 'pending';
  const canDecide =
    isPending &&
    hasAction(auth, 'approval:decide') &&
    detail.reviewerUserIds.includes(auth.userId);
  const canCancel =
    isPending &&
    hasAction(auth, 'approval:cancel') &&
    detail.createdByUserId === auth.userId;

  return (
    <section>
      <a className="back-link" href="#/">
        ← К списку
      </a>
      <div className="page-header">
        <h1>{detail.title}</h1>
        <StatusBadge status={detail.status} />
      </div>

      <div className="card">
        <dl className="detail-grid">
          <div className="detail-item">
            <dt>Тип источника</dt>
            <dd>{SOURCE_TYPE_LABELS[detail.sourceType]}</dd>
          </div>
          <div className="detail-item">
            <dt>ID источника</dt>
            <dd>{detail.sourceId}</dd>
          </div>
          <div className="detail-item">
            <dt>Workspace</dt>
            <dd>{detail.workspaceId}</dd>
          </div>
          <div className="detail-item">
            <dt>Создатель</dt>
            <dd>{detail.createdByUserId}</dd>
          </div>
          <div className="detail-item">
            <dt>Ревьюеры</dt>
            <dd>{detail.reviewerUserIds.join(', ')}</dd>
          </div>
          <div className="detail-item">
            <dt>Создана</dt>
            <dd>{formatDate(detail.createdAt)}</dd>
          </div>
          {detail.decidedByUserId && (
            <div className="detail-item">
              <dt>Решение принял</dt>
              <dd>{detail.decidedByUserId}</dd>
            </div>
          )}
          {detail.decidedAt && (
            <div className="detail-item">
              <dt>Дата решения</dt>
              <dd>{formatDate(detail.decidedAt)}</dd>
            </div>
          )}
          {detail.decisionComment && (
            <div className="detail-item">
              <dt>Комментарий</dt>
              <dd>{detail.decisionComment}</dd>
            </div>
          )}
          {detail.decisionReason && (
            <div className="detail-item">
              <dt>Причина</dt>
              <dd>{detail.decisionReason}</dd>
            </div>
          )}
        </dl>

        {detail.description && <p className="description">{detail.description}</p>}

        {isPending && (
          <>
            {(canDecide || canCancel) && (
              <div className="actions-row">
                {canDecide && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setOpenForm('approve');
                        setText('');
                        setActionError(null);
                      }}
                    >
                      Согласовать
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        setOpenForm('reject');
                        setText('');
                        setActionError(null);
                      }}
                    >
                      Отклонить
                    </button>
                  </>
                )}
                {canCancel && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setOpenForm('cancel');
                      setText('');
                      setActionError(null);
                    }}
                  >
                    Отменить заявку
                  </button>
                )}
              </div>
            )}
            {!canDecide && (
              <p className="muted">
                Согласовать или отклонить могут: {detail.reviewerUserIds.join(', ')}.
                Отменить может создатель ({detail.createdByUserId}).
              </p>
            )}
          </>
        )}

        {actionError && !openForm && (
          <div className="alert alert-error">{actionError}</div>
        )}

        {openForm && (
          <div className="action-form">
            <h3>{DECISION_FORMS[openForm].title}</h3>
            <label className="field">
              {DECISION_FORMS[openForm].field}
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                maxLength={2000}
              />
            </label>
            {actionError && <div className="alert alert-error">{actionError}</div>}
            <div className="actions-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => submitDecision(openForm)}
              >
                {submitting ? 'Отправка…' : 'Подтвердить'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => {
                  setOpenForm(null);
                  setActionError(null);
                }}
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>

      <h2>История</h2>
      <div className="card">
        {detail.history.length === 0 ? (
          <p className="muted">Записей нет.</p>
        ) : (
          <ul className="history">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>
                    {AUDIT_ACTION_LABELS[entry.action] ?? entry.action}
                  </strong>{' '}
                  — {entry.actorUserId}
                </div>
                {auditDetailsText(entry) && (
                  <div className="muted">{auditDetailsText(entry)}</div>
                )}
                <div className="muted">{formatDate(entry.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
