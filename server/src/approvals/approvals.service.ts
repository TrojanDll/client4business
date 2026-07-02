import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ApprovalRequest,
  ApprovalStatus,
  AuditLogEntry,
  Prisma,
} from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { ApiError } from '../common/api-error';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ListApprovalRequestsDto } from './dto/list-approval-requests.dto';

export type DecisionStatus = Extract<
  ApprovalStatus,
  'approved' | 'rejected' | 'canceled'
>;

export interface DecisionInput {
  status: DecisionStatus;
  comment?: string;
  reason?: string;
}

export interface ApprovalRequestView {
  id: string;
  workspaceId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  description: string | null;
  status: string;
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

function toView(request: ApprovalRequest): ApprovalRequestView {
  return {
    id: request.id,
    workspaceId: request.workspaceId,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    title: request.title,
    description: request.description,
    status: request.status,
    reviewerUserIds: request.reviewerUserIds,
    createdByUserId: request.createdByUserId,
    decidedByUserId: request.decidedByUserId,
    decisionComment: request.decisionComment,
    decisionReason: request.decisionReason,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
  };
}

function toAuditView(entry: AuditLogEntry): AuditEntryView {
  return {
    id: entry.id,
    actorUserId: entry.actorUserId,
    action: entry.action,
    details: entry.details,
    createdAt: entry.createdAt.toISOString(),
  };
}

function notFound(): ApiError {
  return new ApiError(
    HttpStatus.NOT_FOUND,
    'NOT_FOUND',
    'Approval request not found',
  );
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateApprovalRequestDto,
    tx: Prisma.TransactionClient,
  ): Promise<ApprovalRequestView> {
    const request = await tx.approvalRequest.create({
      data: {
        workspaceId: auth.workspaceId,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        title: dto.title,
        description: dto.description ?? null,
        reviewerUserIds: dto.reviewerUserIds,
        createdByUserId: auth.userId,
      },
    });
    await tx.auditLogEntry.create({
      data: {
        workspaceId: auth.workspaceId,
        requestId: request.id,
        actorUserId: auth.userId,
        action: 'created',
        details: {
          sourceType: request.sourceType,
          sourceId: request.sourceId,
          title: request.title,
          reviewerUserIds: request.reviewerUserIds,
        },
      },
    });
    await this.outbox.emit(tx, {
      eventType: 'approval_request.created',
      workspaceId: auth.workspaceId,
      requestId: request.id,
      sourceType: request.sourceType,
      sourceId: request.sourceId,
      status: request.status,
      actorUserId: auth.userId,
    });
    return toView(request);
  }

  async list(
    auth: AuthContext,
    query: ListApprovalRequestsDto,
  ): Promise<ApprovalRequestListView> {
    const where: Prisma.ApprovalRequestWhereInput = {
      workspaceId: auth.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.approvalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return {
      items: items.map(toView),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getById(
    auth: AuthContext,
    requestId: string,
  ): Promise<ApprovalRequestDetailView> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { id: requestId, workspaceId: auth.workspaceId },
      include: { auditLog: { orderBy: { createdAt: 'asc' } } },
    });
    if (!request) throw notFound();
    return { ...toView(request), history: request.auditLog.map(toAuditView) };
  }

  async decide(
    auth: AuthContext,
    requestId: string,
    decision: DecisionInput,
    tx: Prisma.TransactionClient,
  ): Promise<ApprovalRequestView> {
    const existing = await tx.approvalRequest.findFirst({
      where: { id: requestId, workspaceId: auth.workspaceId },
    });
    if (!existing) throw notFound();
    this.assertActorAllowed(auth, existing, decision.status);

    const { count } = await tx.approvalRequest.updateMany({
      where: {
        id: requestId,
        workspaceId: auth.workspaceId,
        status: ApprovalStatus.pending,
      },
      data: {
        status: decision.status,
        decidedByUserId: auth.userId,
        decisionComment: decision.comment ?? null,
        decisionReason: decision.reason ?? null,
        decidedAt: new Date(),
      },
    });
    if (count === 0) {
      const current = await tx.approvalRequest.findFirst({
        where: { id: requestId, workspaceId: auth.workspaceId },
      });
      if (!current) throw notFound();
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        `Approval request is already ${current.status}`,
      );
    }

    const updated = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    await tx.auditLogEntry.create({
      data: {
        workspaceId: auth.workspaceId,
        requestId,
        actorUserId: auth.userId,
        action: decision.status,
        details:
          decision.status === 'approved'
            ? { comment: decision.comment ?? null }
            : { reason: decision.reason ?? null },
      },
    });
    await this.outbox.emit(tx, {
      eventType: `approval_request.${decision.status}`,
      workspaceId: auth.workspaceId,
      requestId,
      sourceType: updated.sourceType,
      sourceId: updated.sourceId,
      status: updated.status,
      actorUserId: auth.userId,
    });
    return toView(updated);
  }

  private assertActorAllowed(
    auth: AuthContext,
    request: ApprovalRequest,
    status: DecisionStatus,
  ): void {
    if (status === 'canceled') {
      if (request.createdByUserId !== auth.userId) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'NOT_A_REQUESTER',
          'Only the requester can cancel this approval request',
        );
      }
      return;
    }
    if (!request.reviewerUserIds.includes(auth.userId)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'NOT_A_REVIEWER',
        'Only a reviewer can decide this approval request',
      );
    }
  }
}
