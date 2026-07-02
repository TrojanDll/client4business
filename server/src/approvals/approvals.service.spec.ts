import { ApprovalRequest, Prisma } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService, DecisionInput } from './approvals.service';

const REQUESTER = 'usr_requester';
const REVIEWER = 'usr_reviewer';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

interface TxMock {
  approvalRequest: {
    create: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  auditLogEntry: { create: jest.Mock };
}

function makeTx(): TxMock {
  return {
    approvalRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    auditLogEntry: { create: jest.fn() },
  };
}

function auth(userId: string): AuthContext {
  return { userId, workspaceId: 'ws_1', actions: [] };
}

function makeRequest(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    id: REQUEST_ID,
    workspaceId: 'ws_1',
    sourceType: 'publication',
    sourceId: 'pub_1',
    title: 'Announcement',
    description: null,
    status: 'pending',
    reviewerUserIds: [REVIEWER],
    createdByUserId: REQUESTER,
    decidedByUserId: null,
    decisionComment: null,
    decisionReason: null,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    decidedAt: null,
    ...overrides,
  };
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<ApiError> {
  const error: unknown = await promise.then(
    () => {
      throw new Error(`expected ApiError ${status} ${code}`);
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  const apiError = error as ApiError;
  expect(apiError.getStatus()).toBe(status);
  expect((apiError.getResponse() as { code: string }).code).toBe(code);
  return apiError;
}

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let outbox: { emit: jest.Mock };
  let tx: TxMock;

  beforeEach(() => {
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    tx = makeTx();
    service = new ApprovalsService({} as unknown as PrismaService, outbox);
  });

  const txClient = (): Prisma.TransactionClient =>
    tx as unknown as Prisma.TransactionClient;

  describe('create', () => {
    it('creates request, audit entry and outbox event, returns view', async () => {
      tx.approvalRequest.create.mockResolvedValue(makeRequest());

      const view = await service.create(
        auth(REQUESTER),
        {
          sourceType: 'publication',
          sourceId: 'pub_1',
          title: 'Announcement',
          reviewerUserIds: [REVIEWER],
        },
        txClient(),
      );

      expect(tx.approvalRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws_1',
          createdByUserId: REQUESTER,
          sourceType: 'publication',
          sourceId: 'pub_1',
          title: 'Announcement',
          description: null,
          reviewerUserIds: [REVIEWER],
        }) as unknown,
      });
      expect(tx.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws_1',
          requestId: REQUEST_ID,
          actorUserId: REQUESTER,
          action: 'created',
        }) as unknown,
      });
      expect(outbox.emit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: 'approval_request.created',
          workspaceId: 'ws_1',
          requestId: REQUEST_ID,
          status: 'pending',
          actorUserId: REQUESTER,
        }),
      );
      expect(view).toMatchObject({
        id: REQUEST_ID,
        status: 'pending',
        createdAt: '2026-07-01T10:00:00.000Z',
        decidedAt: null,
      });
    });
  });

  describe('decide', () => {
    const decide = (actor: string, decision: DecisionInput): Promise<unknown> =>
      service.decide(auth(actor), REQUEST_ID, decision, txClient());

    it('404 when request does not exist in the workspace', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(null);

      await expectApiError(
        decide(REVIEWER, { status: 'approved' }),
        404,
        'NOT_FOUND',
      );
      expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
    });

    it('403 NOT_A_REVIEWER when approve is attempted by a non-reviewer', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());

      await expectApiError(
        decide(REQUESTER, { status: 'approved' }),
        403,
        'NOT_A_REVIEWER',
      );
      expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
    });

    it('403 NOT_A_REVIEWER when reject is attempted by a non-reviewer', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());

      await expectApiError(
        decide('usr_outsider', { status: 'rejected', reason: 'no' }),
        403,
        'NOT_A_REVIEWER',
      );
    });

    it('403 NOT_A_REQUESTER when cancel is attempted by a non-requester', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());

      await expectApiError(
        decide(REVIEWER, { status: 'canceled' }),
        403,
        'NOT_A_REQUESTER',
      );
      expect(tx.approvalRequest.updateMany).not.toHaveBeenCalled();
    });

    it('409 CONFLICT when the request is already final', async () => {
      tx.approvalRequest.findFirst
        .mockResolvedValueOnce(makeRequest({ status: 'approved' }))
        .mockResolvedValueOnce(makeRequest({ status: 'approved' }));
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 0 });

      const error = await expectApiError(
        decide(REVIEWER, { status: 'rejected', reason: 'late' }),
        409,
        'CONFLICT',
      );
      expect((error.getResponse() as { message: string }).message).toContain(
        'approved',
      );
      expect(tx.auditLogEntry.create).not.toHaveBeenCalled();
      expect(outbox.emit).not.toHaveBeenCalled();
    });

    it('404 when the request vanishes between the guard read and the update', async () => {
      tx.approvalRequest.findFirst
        .mockResolvedValueOnce(makeRequest())
        .mockResolvedValueOnce(null);
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 0 });

      await expectApiError(
        decide(REVIEWER, { status: 'approved' }),
        404,
        'NOT_FOUND',
      );
    });

    it('approve transitions only from pending and records audit + outbox', async () => {
      const updated = makeRequest({
        status: 'approved',
        decidedByUserId: REVIEWER,
        decisionComment: 'looks good',
        decidedAt: new Date('2026-07-01T11:00:00.000Z'),
      });
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.approvalRequest.findUniqueOrThrow.mockResolvedValue(updated);

      const view = (await decide(REVIEWER, {
        status: 'approved',
        comment: 'looks good',
      })) as { status: string; decidedAt: string | null };

      expect(tx.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: REQUEST_ID,
            workspaceId: 'ws_1',
            status: 'pending',
          },
        }),
      );
      expect(tx.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'approved',
          actorUserId: REVIEWER,
          details: { comment: 'looks good' },
        }) as unknown,
      });
      expect(outbox.emit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          eventType: 'approval_request.approved',
          status: 'approved',
          actorUserId: REVIEWER,
        }),
      );
      expect(view.status).toBe('approved');
      expect(view.decidedAt).toBe('2026-07-01T11:00:00.000Z');
    });

    it('reject records the reason in audit details and outbox event type', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.approvalRequest.findUniqueOrThrow.mockResolvedValue(
        makeRequest({ status: 'rejected', decisionReason: 'wrong tone' }),
      );

      await decide(REVIEWER, { status: 'rejected', reason: 'wrong tone' });

      expect(tx.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'rejected',
          details: { reason: 'wrong tone' },
        }) as unknown,
      });
      expect(outbox.emit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ eventType: 'approval_request.rejected' }),
      );
    });

    it('cancel is allowed for the requester even if they are not a reviewer', async () => {
      tx.approvalRequest.findFirst.mockResolvedValue(makeRequest());
      tx.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.approvalRequest.findUniqueOrThrow.mockResolvedValue(
        makeRequest({ status: 'canceled' }),
      );

      await decide(REQUESTER, { status: 'canceled' });

      expect(tx.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'canceled',
          details: { reason: null },
        }) as unknown,
      });
      expect(outbox.emit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ eventType: 'approval_request.canceled' }),
      );
    });
  });
});
