import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { IdempotencyKey, Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuthContext } from '../auth/auth-context';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdempotentResponse {
  status: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    auth: AuthContext,
    request: Request,
    handler: (tx: Prisma.TransactionClient) => Promise<IdempotentResponse>,
  ): Promise<IdempotentResponse> {
    const rawKey = request.headers['idempotency-key'];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || !UUID_PATTERN.test(key)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Idempotency-Key header is required and must be a UUID',
      );
    }

    const fingerprint = createHash('sha256')
      .update(
        `${request.method}\n${request.path}\n${JSON.stringify(request.body ?? {})}`,
      )
      .digest('hex');
    const uniqueKey = {
      workspaceId_userId_key: {
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        key,
      },
    };

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: uniqueKey,
    });
    if (existing) return this.replay(existing, fingerprint);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const response = await handler(tx);
        await tx.idempotencyKey.create({
          data: {
            workspaceId: auth.workspaceId,
            userId: auth.userId,
            key,
            fingerprint,
            responseStatus: response.status,
            responseBody: response.body as Prisma.InputJsonValue,
          },
        });
        return response;
      });
    } catch (error) {
      // Concurrent retry with the same key loses the unique-constraint race.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.idempotencyKey.findUnique({
          where: uniqueKey,
        });
        if (winner) return this.replay(winner, fingerprint);
      }
      throw error;
    }
  }

  private replay(
    record: IdempotencyKey,
    fingerprint: string,
  ): IdempotentResponse {
    if (record.fingerprint !== fingerprint) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IDEMPOTENCY_KEY_REUSE',
        'Idempotency-Key was already used with a different request',
      );
    }
    return { status: record.responseStatus, body: record.responseBody };
  }
}
