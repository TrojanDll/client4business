import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type {
  ApprovalRequestListView,
  ApprovalStatus,
  SourceType,
} from '../api/types';
import { SOURCE_TYPES, STATUSES } from '../api/types';
import type { AuthState } from '../auth/auth';
import { hasAction } from '../auth/auth';
import { StatusBadge } from '../components/StatusBadge';
import {
  SOURCE_TYPE_LABELS,
  STATUS_LABELS,
  errorMessage,
  formatDate,
} from '../lib/format';

const LIMIT = 20;

interface Props {
  auth: AuthState;
}

export function RequestListPage({ auth }: Props) {
  const [status, setStatus] = useState<ApprovalStatus | ''>('');
  const [sourceType, setSourceType] = useState<SourceType | ''>('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ApprovalRequestListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .list(auth, { status, sourceType, limit: LIMIT, offset })
      .then((result) => {
        if (cancelled) return;
        setData(result);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, status, sourceType, offset]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <section>
      <div className="page-header">
        <h1>Заявки на согласование</h1>
        {hasAction(auth, 'approval:create') && (
          <a className="btn btn-primary" href="#/create">
            Создать заявку
          </a>
        )}
      </div>

      <div className="filters">
        <label>
          Статус
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApprovalStatus | '');
              setOffset(0);
            }}
          >
            <option value="">Все статусы</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тип источника
          <select
            value={sourceType}
            onChange={(event) => {
              setSourceType(event.target.value as SourceType | '');
              setOffset(0);
            }}
          >
            <option value="">Все типы</option>
            {SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {SOURCE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!error && (
        <div className="card">
          {loading && !data ? (
            <p className="muted">Загрузка…</p>
          ) : items.length === 0 ? (
            <p className="muted">Заявок нет.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Заголовок</th>
                  <th>Источник</th>
                  <th>Статус</th>
                  <th>Создатель</th>
                  <th>Создана</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => {
                      window.location.hash = `/requests/${item.id}`;
                    }}
                  >
                    <td className="cell-title">{item.title}</td>
                    <td>
                      {SOURCE_TYPE_LABELS[item.sourceType]} · {item.sourceId}
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{item.createdByUserId}</td>
                    <td>{formatDate(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {total > 0 && (
            <div className="pagination">
              <span className="muted">
                {offset + 1}–{offset + items.length} из {total}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                ← Назад
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={offset + items.length >= total}
                onClick={() => setOffset(offset + LIMIT)}
              >
                Вперёд →
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
