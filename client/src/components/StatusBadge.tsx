import type { ApprovalStatus } from '../api/types';
import { STATUS_LABELS } from '../lib/format';

export function StatusBadge({ status }: { status: ApprovalStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}
