import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { AuthContext } from '../auth/auth-context';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';

const KEY = '7a4f0af1-9a5b-4d5c-8f2e-3b1a2c3d4e5f';
const PATH = '/api/v1/workspaces/ws_1/approval-requests';
const AUTH: AuthContext = { userId: 'usr_1', workspaceId: 'ws_1', actions: [] };

function httpRequest(
  key: string | string[] | undefined,
  body: unknown = { title: 'a' },
): Request {
  return {
    headers: key === undefined ? {} : { 'idempotency-key': key },
    method: 'POST',
    path: PATH,
    body,
  } as unknown as Request;
}

function fingerprintOf(body: unknown): string {
  return createHash('sha256')
    .update(`POST\n${PATH}\n${JSON.stringify(body)}`)
    .digest('hex');
}

function storedKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    workspaceId: 'ws_1',
    userId: 'usr_1',
    key: KEY,
    fingerprint: fingerprintOf({ title: 'a' }),
    responseStatus: 201,
    responseBody: { id: 'req-1' },
    createdAt: new Date(),
    ...overrides,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
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
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let findUnique: jest.Mock;
  let txCreate: jest.Mock;
  let transaction: jest.Mock;
  let handler: jest.Mock;

  beforeEach(() => {
    findUnique = jest.fn();
    txCreate = jest.fn().mockResolvedValue(undefined);
    const tx = { idempotencyKey: { create: txCreate } };
    transaction = jest
      .fn()
      .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));
    handler = jest
      .fn()
      .mockResolvedValue({ status: 201, body: { id: 'req-1' } });
    service = new IdempotencyService({
      idempotencyKey: { findUnique },
      $transaction: transaction,
    } as unknown as PrismaService);
  });

  it('400 when Idempotency-Key header is missing', async () => {
    await expectApiError(
      service.execute(AUTH, httpRequest(undefined), handler),
      400,
      'VALIDATION_ERROR',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('400 when Idempotency-Key is not a UUID', async () => {
    await expectApiError(
      service.execute(AUTH, httpRequest('not-a-uuid'), handler),
      400,
      'VALIDATION_ERROR',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the handler in a transaction and stores the response for a new key', async () => {
    findUnique.mockResolvedValue(null);

    const result = await service.execute(AUTH, httpRequest(KEY), handler);

    expect(result).toEqual({ status: 201, body: { id: 'req-1' } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(txCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws_1',
        userId: 'usr_1',
        key: KEY,
        fingerprint: fingerprintOf({ title: 'a' }),
        responseStatus: 201,
        responseBody: { id: 'req-1' },
      },
    });
  });

  it('replays the stored response for a repeated key with the same fingerprint', async () => {
    findUnique.mockResolvedValue(storedKey());

    const result = await service.execute(AUTH, httpRequest(KEY), handler);

    expect(result).toEqual({ status: 201, body: { id: 'req-1' } });
    expect(handler).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('422 IDEMPOTENCY_KEY_REUSE when the same key is reused with a different body', async () => {
    findUnique.mockResolvedValue(storedKey());

    await expectApiError(
      service.execute(AUTH, httpRequest(KEY, { title: 'different' }), handler),
      422,
      'IDEMPOTENCY_KEY_REUSE',
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('replays the winner when a concurrent retry loses the unique-constraint race', async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedKey({ responseBody: { id: 'winner' } }));
    transaction.mockRejectedValue(p2002());

    const result = await service.execute(AUTH, httpRequest(KEY), handler);

    expect(result).toEqual({ status: 201, body: { id: 'winner' } });
  });

  it('422 when the race winner was stored with a different fingerprint', async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        storedKey({ fingerprint: fingerprintOf({ title: 'other' }) }),
      );
    transaction.mockRejectedValue(p2002());

    await expectApiError(
      service.execute(AUTH, httpRequest(KEY), handler),
      422,
      'IDEMPOTENCY_KEY_REUSE',
    );
  });

  it('rethrows P2002 if no stored key is found afterwards', async () => {
    findUnique.mockResolvedValue(null);
    transaction.mockRejectedValue(p2002());

    await expect(
      service.execute(AUTH, httpRequest(KEY), handler),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('rethrows non-P2002 errors without replay lookup', async () => {
    findUnique.mockResolvedValue(null);
    transaction.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.execute(AUTH, httpRequest(KEY), handler),
    ).rejects.toThrow('connection lost');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses the first value when the header arrives as an array', async () => {
    findUnique.mockResolvedValue(null);

    const result = await service.execute(AUTH, httpRequest([KEY]), handler);

    expect(result.status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
