import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  ApprovalRequestDetailView,
  ApprovalRequestListView,
  ApprovalRequestView,
} from '../src/approvals/approvals.service';
import { OutboxPublisher } from '../src/outbox/outbox-publisher.service';
import { PrismaService } from '../src/prisma/prisma.service';

interface ErrorBody {
  error: { code: string; message: string };
}

const WS = 'ws_1';
const OTHER_WS = 'ws_2';
const REQUESTER = 'usr_requester';
const REVIEWER = 'usr_reviewer';
const OUTSIDER = 'usr_outsider';
const ALL_ACTIONS =
  'approval:read,approval:create,approval:decide,approval:cancel';

const createBody = {
  sourceType: 'publication',
  sourceId: 'pub_1',
  title: 'Post announcement',
  description: 'Please check the tone',
  reviewerUserIds: [REVIEWER],
};

describe('approval-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());

  function authHeaders(
    userId: string,
    workspaceId: string = WS,
    actions: string = ALL_ACTIONS,
  ): Record<string, string> {
    return {
      'X-User-Id': userId,
      'X-Workspace-Id': workspaceId,
      'X-Actions': actions,
    };
  }

  async function createRequest(
    overrides: Partial<typeof createBody> = {},
    key: string = randomUUID(),
  ): Promise<ApprovalRequestView> {
    const res = await http()
      .post(`/api/v1/workspaces/${WS}/approval-requests`)
      .set(authHeaders(REQUESTER))
      .set('Idempotency-Key', key)
      .send({ ...createBody, ...overrides });
    expect(res.status).toBe(201);
    return res.body as ApprovalRequestView;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE audit_log, outbox_events, idempotency_keys, approval_requests CASCADE',
    );
  });

  describe('health endpoints', () => {
    it('GET /health responds 200 without auth', async () => {
      const res = await http().get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('GET /ready responds 200 when the database is reachable', async () => {
      const res = await http().get('/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ready' });
    });
  });

  describe('auth stub', () => {
    it('401 UNAUTHORIZED without auth headers', async () => {
      const res = await http().get(
        `/api/v1/workspaces/${WS}/approval-requests`,
      );
      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('403 FORBIDDEN when the path workspace differs from the token workspace', async () => {
      const res = await http()
        .get(`/api/v1/workspaces/${OTHER_WS}/approval-requests`)
        .set(authHeaders(REQUESTER, WS));
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN on create without the approval:create action', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER, WS, 'approval:read'))
        .set('Idempotency-Key', randomUUID())
        .send(createBody);
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN on approve without the approval:decide action', async () => {
      const res = await http()
        .post(
          `/api/v1/workspaces/${WS}/approval-requests/${randomUUID()}/approve`,
        )
        .set(authHeaders(REVIEWER, WS, 'approval:read,approval:cancel'))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('403 FORBIDDEN on cancel without the approval:cancel action', async () => {
      const res = await http()
        .post(
          `/api/v1/workspaces/${WS}/approval-requests/${randomUUID()}/cancel`,
        )
        .set(
          authHeaders(
            REQUESTER,
            WS,
            ALL_ACTIONS.replace(',approval:cancel', ''),
          ),
        )
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });
  });

  describe('create', () => {
    it('creates a pending request with audit trail and outbox event', async () => {
      const view = await createRequest();

      expect(view).toMatchObject({
        workspaceId: WS,
        sourceType: 'publication',
        sourceId: 'pub_1',
        title: 'Post announcement',
        description: 'Please check the tone',
        status: 'pending',
        reviewerUserIds: [REVIEWER],
        createdByUserId: REQUESTER,
        decidedByUserId: null,
        decidedAt: null,
      });
      expect(view.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(view.createdAt).toISOString()).toBe(view.createdAt);

      expect(await prisma.approvalRequest.count()).toBe(1);
      const audit = await prisma.auditLogEntry.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        workspaceId: WS,
        requestId: view.id,
        actorUserId: REQUESTER,
        action: 'created',
      });
      const events = await prisma.outboxEvent.findMany();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('approval_request.created');
    });

    it('400 VALIDATION_ERROR without an Idempotency-Key header', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .send(createBody);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.approvalRequest.count()).toBe(0);
    });

    it('400 VALIDATION_ERROR when Idempotency-Key is not a UUID', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', 'not-a-uuid')
        .send(createBody);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('400 VALIDATION_ERROR on an empty title', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', randomUUID())
        .send({ ...createBody, title: '' });
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('400 VALIDATION_ERROR on an empty reviewer list', async () => {
      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', randomUUID())
        .send({ ...createBody, reviewerUserIds: [] });
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('idempotency', () => {
    it('replays the same response for a repeated create and stores a single row', async () => {
      const key = randomUUID();
      const first = await createRequest({}, key);
      const second = await createRequest({}, key);

      expect(second).toEqual(first);
      expect(await prisma.approvalRequest.count()).toBe(1);
      expect(await prisma.idempotencyKey.count()).toBe(1);
      expect(await prisma.outboxEvent.count()).toBe(1);
    });

    it('422 IDEMPOTENCY_KEY_REUSE when the same key is sent with a different body', async () => {
      const key = randomUUID();
      await createRequest({}, key);

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', key)
        .send({ ...createBody, title: 'Different title' });
      expect(res.status).toBe(422);
      expect((res.body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSE');
      expect(await prisma.approvalRequest.count()).toBe(1);
    });

    it('replays a decision instead of returning 409 when retried with the same key', async () => {
      const view = await createRequest();
      const key = randomUUID();
      const decide = () =>
        http()
          .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/approve`)
          .set(authHeaders(REVIEWER))
          .set('Idempotency-Key', key)
          .send({ comment: 'ok' });

      const first = await decide();
      expect(first.status).toBe(200);
      const second = await decide();
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await prisma.auditLogEntry.count()).toBe(2);
    });

    it('does not cache error responses: a failed key can be retried successfully', async () => {
      const key = randomUUID();
      const bad = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', key)
        .send({ ...createBody, title: '' });
      expect(bad.status).toBe(400);

      await createRequest({}, key);
      expect(await prisma.approvalRequest.count()).toBe(1);
    });
  });

  describe('decisions', () => {
    it('happy path: create then approve by a reviewer', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/approve`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({ comment: 'looks good' });

      expect(res.status).toBe(200);
      const approved = res.body as ApprovalRequestView;
      expect(approved).toMatchObject({
        id: view.id,
        status: 'approved',
        decidedByUserId: REVIEWER,
        decisionComment: 'looks good',
      });
      expect(approved.decidedAt).not.toBeNull();

      const detail = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests/${view.id}`)
        .set(authHeaders(REQUESTER));
      expect(detail.status).toBe(200);
      const history = (detail.body as ApprovalRequestDetailView).history;
      expect(history.map((entry) => entry.action)).toEqual([
        'created',
        'approved',
      ]);
      expect(history[1].actorUserId).toBe(REVIEWER);

      const events = await prisma.outboxEvent.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((event) => event.eventType)).toEqual([
        'approval_request.created',
        'approval_request.approved',
      ]);
    });

    it('reject stores the reason', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/reject`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'wrong tone' });

      expect(res.status).toBe(200);
      expect(res.body as ApprovalRequestView).toMatchObject({
        status: 'rejected',
        decidedByUserId: REVIEWER,
        decisionReason: 'wrong tone',
      });
    });

    it('400 VALIDATION_ERROR on reject without a reason', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/reject`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });

    it('cancel by the requester works without a reason', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/cancel`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', randomUUID())
        .send({});

      expect(res.status).toBe(200);
      expect(res.body as ApprovalRequestView).toMatchObject({
        status: 'canceled',
        decidedByUserId: REQUESTER,
        decisionReason: null,
      });
    });

    it('409 CONFLICT on a second decision for a finalized request', async () => {
      const view = await createRequest();
      await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/approve`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/reject`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'changed my mind' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).error.code).toBe('CONFLICT');
      expect((res.body as ErrorBody).error.message).toContain('approved');
    });

    it('409 CONFLICT on cancel after reject', async () => {
      const view = await createRequest();
      await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/reject`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({ reason: 'no' })
        .expect(200);

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/cancel`)
        .set(authHeaders(REQUESTER))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(409);
      expect((res.body as ErrorBody).error.code).toBe('CONFLICT');

      const stored = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: view.id },
      });
      expect(stored.status).toBe('rejected');
    });

    it('403 NOT_A_REVIEWER when approve is attempted by a non-reviewer', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/approve`)
        .set(authHeaders(OUTSIDER))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('NOT_A_REVIEWER');
    });

    it('403 NOT_A_REQUESTER when cancel is attempted by a reviewer', async () => {
      const view = await createRequest();

      const res = await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/cancel`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(403);
      expect((res.body as ErrorBody).error.code).toBe('NOT_A_REQUESTER');
    });

    it('404 NOT_FOUND for a non-existent request id', async () => {
      const res = await http()
        .post(
          `/api/v1/workspaces/${WS}/approval-requests/${randomUUID()}/approve`,
        )
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
    });

    it('404 NOT_FOUND for a malformed request id in the path', async () => {
      const res = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests/not-a-uuid`)
        .set(authHeaders(REQUESTER));
      expect(res.status).toBe(404);
      expect((res.body as ErrorBody).error.code).toBe('NOT_FOUND');
    });
  });

  describe('workspace isolation', () => {
    it('a request from another workspace is invisible: 404 on read and decide', async () => {
      const view = await createRequest();

      const read = await http()
        .get(`/api/v1/workspaces/${OTHER_WS}/approval-requests/${view.id}`)
        .set(authHeaders(REQUESTER, OTHER_WS));
      expect(read.status).toBe(404);

      const decideRes = await http()
        .post(
          `/api/v1/workspaces/${OTHER_WS}/approval-requests/${view.id}/approve`,
        )
        .set(authHeaders(REVIEWER, OTHER_WS))
        .set('Idempotency-Key', randomUUID())
        .send({});
      expect(decideRes.status).toBe(404);

      const stored = await prisma.approvalRequest.findUniqueOrThrow({
        where: { id: view.id },
      });
      expect(stored.status).toBe('pending');
    });

    it('the list of another workspace stays empty', async () => {
      await createRequest();

      const res = await http()
        .get(`/api/v1/workspaces/${OTHER_WS}/approval-requests`)
        .set(authHeaders(REQUESTER, OTHER_WS));
      expect(res.status).toBe(200);
      expect(res.body as ApprovalRequestListView).toMatchObject({
        items: [],
        total: 0,
      });
    });
  });

  describe('list', () => {
    it('filters by status and sourceType, paginates and sorts by createdAt desc', async () => {
      const first = await createRequest({ sourceId: 'pub_a' });
      await createRequest({ sourceId: 'pub_b' });
      await createRequest({ sourceType: 'scenario', sourceId: 'scn_a' });
      const toApprove = await createRequest({
        sourceType: 'edit',
        sourceId: 'edit_a',
      });
      await http()
        .post(
          `/api/v1/workspaces/${WS}/approval-requests/${toApprove.id}/approve`,
        )
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(200);

      const all = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests`)
        .set(authHeaders(REQUESTER));
      const allBody = all.body as ApprovalRequestListView;
      expect(allBody.total).toBe(4);
      expect(allBody.limit).toBe(20);
      expect(allBody.offset).toBe(0);
      const dates = allBody.items.map((item) =>
        new Date(item.createdAt).getTime(),
      );
      expect([...dates].sort((a, b) => b - a)).toEqual(dates);

      const pending = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?status=pending`)
        .set(authHeaders(REQUESTER));
      expect((pending.body as ApprovalRequestListView).total).toBe(3);

      const approved = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?status=approved`)
        .set(authHeaders(REQUESTER));
      const approvedBody = approved.body as ApprovalRequestListView;
      expect(approvedBody.total).toBe(1);
      expect(approvedBody.items[0].id).toBe(toApprove.id);

      const scenarios = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?sourceType=scenario`)
        .set(authHeaders(REQUESTER));
      expect((scenarios.body as ApprovalRequestListView).total).toBe(1);

      const pageOne = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?limit=3&offset=0`)
        .set(authHeaders(REQUESTER));
      const pageTwo = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?limit=3&offset=3`)
        .set(authHeaders(REQUESTER));
      const pageOneBody = pageOne.body as ApprovalRequestListView;
      const pageTwoBody = pageTwo.body as ApprovalRequestListView;
      expect(pageOneBody.items).toHaveLength(3);
      expect(pageOneBody.limit).toBe(3);
      expect(pageTwoBody.items).toHaveLength(1);
      expect(pageTwoBody.offset).toBe(3);
      const ids = new Set(
        [...pageOneBody.items, ...pageTwoBody.items].map((item) => item.id),
      );
      expect(ids.size).toBe(4);
      expect(pageTwoBody.items[0].id).toBe(first.id);
    });

    it('400 VALIDATION_ERROR when limit exceeds 100', async () => {
      const res = await http()
        .get(`/api/v1/workspaces/${WS}/approval-requests?limit=101`)
        .set(authHeaders(REQUESTER));
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('outbox publisher', () => {
    it('publishes pending events and keeps payloads free of content fields', async () => {
      const view = await createRequest();
      await http()
        .post(`/api/v1/workspaces/${WS}/approval-requests/${view.id}/approve`)
        .set(authHeaders(REVIEWER))
        .set('Idempotency-Key', randomUUID())
        .send({ comment: 'secret comment' })
        .expect(200);

      await app.get(OutboxPublisher).publishPending();

      const events = await prisma.outboxEvent.findMany({
        orderBy: { createdAt: 'asc' },
      });
      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event.publishedAt).not.toBeNull();
        const payload = event.payload as Record<string, unknown>;
        expect(Object.keys(payload).sort()).toEqual([
          'actorUserId',
          'eventId',
          'occurredAt',
          'requestId',
          'sourceId',
          'sourceType',
          'status',
          'workspaceId',
        ]);
      }
    });
  });
});
