import { useState } from 'react';
import { api } from '../api/client';
import type { SourceType } from '../api/types';
import { SOURCE_TYPES } from '../api/types';
import type { AuthState } from '../auth/auth';
import { SOURCE_TYPE_LABELS, errorMessage } from '../lib/format';
import { useIdempotentAction } from '../lib/use-idempotent-action';

interface Props {
  auth: AuthState;
}

export function CreateRequestPage({ auth }: Props) {
  const [sourceType, setSourceType] = useState<SourceType>('publication');
  const [sourceId, setSourceId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reviewers, setReviewers] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const runCreate = useIdempotentAction();

  function validate(): string | null {
    if (!title.trim() || title.trim().length > 200) {
      return 'Заголовок обязателен (до 200 символов).';
    }
    if (!sourceId.trim() || sourceId.trim().length > 100) {
      return 'ID источника обязателен (до 100 символов).';
    }
    if (description.length > 2000) {
      return 'Описание не должно превышать 2000 символов.';
    }
    const list = parseReviewers();
    if (list.length === 0 || list.length > 50) {
      return 'Укажите от 1 до 50 ревьюеров.';
    }
    if (list.some((reviewer) => reviewer.length > 100)) {
      return 'ID ревьюера не должен превышать 100 символов.';
    }
    return null;
  }

  function parseReviewers(): string[] {
    return [
      ...new Set(
        reviewers
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ];
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    runCreate((key) =>
      api.create(
        auth,
        {
          sourceType,
          sourceId: sourceId.trim(),
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          reviewerUserIds: parseReviewers(),
        },
        key,
      ),
    )
      .then((view) => {
        window.location.hash = `/requests/${view.id}`;
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setSubmitting(false));
  }

  return (
    <section>
      <a className="back-link" href="#/">
        ← К списку
      </a>
      <h1>Новая заявка на согласование</h1>
      <form className="card form-grid" onSubmit={submit}>
        <label className="field">
          Тип источника
          <select
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as SourceType)}
          >
            {SOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {SOURCE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          ID источника
          <input
            type="text"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            placeholder="pub_42"
            required
          />
        </label>
        <label className="field">
          Заголовок
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Анонс запуска"
            required
          />
        </label>
        <label className="field">
          Описание (необязательно)
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </label>
        <label className="field">
          Ревьюеры (через запятую или с новой строки)
          <textarea
            value={reviewers}
            onChange={(event) => setReviewers(event.target.value)}
            rows={2}
            placeholder="usr_2, usr_3"
            required
          />
        </label>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="actions-row">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Создание…' : 'Создать'}
          </button>
          <a className="btn btn-ghost" href="#/">
            Отмена
          </a>
        </div>
      </form>
    </section>
  );
}
