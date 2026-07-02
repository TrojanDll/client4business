import { ApiError, NetworkError } from '../api/client';
import type { ApprovalStatus, SourceType } from '../api/types';

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Ожидает',
  approved: 'Согласована',
  rejected: 'Отклонена',
  canceled: 'Отменена',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  publication: 'Публикация',
  scenario: 'Сценарий',
  edit: 'Правка',
  external: 'Внешний источник',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  created: 'Заявка создана',
  approved: 'Заявка согласована',
  rejected: 'Заявка отклонена',
  canceled: 'Заявка отменена',
};

const CODE_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Не указаны данные входа. Заполните панель входа сверху.',
  FORBIDDEN: 'Недостаточно прав для этого действия.',
  NOT_A_REVIEWER: 'Вы не входите в список ревьюеров этой заявки.',
  NOT_A_REQUESTER: 'Отменить заявку может только её создатель.',
  NOT_FOUND: 'Заявка не найдена.',
  CONFLICT: 'Заявка уже получила финальное решение.',
  IDEMPOTENCY_KEY_REUSE:
    'Повтор запроса отличается от исходного. Обновите страницу и попробуйте снова.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_ERROR') {
      return `Проверьте заполнение полей: ${error.message}`;
    }
    return CODE_MESSAGES[error.code] ?? `Ошибка ${error.status}: ${error.message}`;
  }
  if (error instanceof NetworkError) {
    return 'Не удалось связаться с сервером. Повторите попытку — запрос не задублируется.';
  }
  return 'Неизвестная ошибка.';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
