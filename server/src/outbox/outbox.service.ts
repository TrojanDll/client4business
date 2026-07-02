import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApprovalStatus, Prisma, SourceType } from '@prisma/client';

export interface ApprovalEventInput {
  eventType: string;
  workspaceId: string;
  requestId: string;
  sourceType: SourceType;
  sourceId: string;
  status: ApprovalStatus;
  actorUserId: string;
}

@Injectable()
export class OutboxService {
  async emit(
    tx: Prisma.TransactionClient,
    input: ApprovalEventInput,
  ): Promise<void> {
    const eventId = randomUUID();
    await tx.outboxEvent.create({
      data: {
        id: eventId,
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        payload: {
          eventId,
          occurredAt: new Date().toISOString(),
          workspaceId: input.workspaceId,
          requestId: input.requestId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          status: input.status,
          actorUserId: input.actorUserId,
        },
      },
    });
  }
}
