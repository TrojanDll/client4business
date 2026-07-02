import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/api-error';
import { AuthContext } from './auth-context';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRED_ACTIONS_KEY } from './require-actions.decorator';

interface FakeRequest {
  headers: Record<string, string | string[]>;
  params: Record<string, string>;
  auth?: AuthContext;
}

function makeGuard(options: {
  isPublic?: boolean;
  required?: string[];
}): AuthGuard {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return options.isPublic ?? false;
      if (key === REQUIRED_ACTIONS_KEY) return options.required;
      return undefined;
    }),
  } as unknown as Reflector;
  return new AuthGuard(reflector);
}

function makeContext(request: FakeRequest): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function validRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    headers: {
      'x-user-id': 'usr_1',
      'x-workspace-id': 'ws_1',
      'x-actions': 'approval:read,approval:create',
    },
    params: { workspaceId: 'ws_1' },
    ...overrides,
  };
}

function catchApiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('expected ApiError to be thrown');
}

function expectApiError(fn: () => unknown, status: number, code: string): void {
  const error = catchApiError(fn);
  expect(error.getStatus()).toBe(status);
  expect((error.getResponse() as { code: string }).code).toBe(code);
}

describe('AuthGuard', () => {
  it('lets public routes through without headers', () => {
    const guard = makeGuard({ isPublic: true });
    const request = validRequest({ headers: {}, params: {} });

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.auth).toBeUndefined();
  });

  it('401 UNAUTHORIZED when X-User-Id is missing', () => {
    const guard = makeGuard({});
    const request = validRequest();
    delete request.headers['x-user-id'];

    expectApiError(
      () => guard.canActivate(makeContext(request)),
      401,
      'UNAUTHORIZED',
    );
  });

  it('401 UNAUTHORIZED when X-Workspace-Id is missing', () => {
    const guard = makeGuard({});
    const request = validRequest();
    delete request.headers['x-workspace-id'];

    expectApiError(
      () => guard.canActivate(makeContext(request)),
      401,
      'UNAUTHORIZED',
    );
  });

  it('403 FORBIDDEN when the path workspace differs from the token workspace', () => {
    const guard = makeGuard({});
    const request = validRequest({ params: { workspaceId: 'ws_2' } });

    expectApiError(
      () => guard.canActivate(makeContext(request)),
      403,
      'FORBIDDEN',
    );
  });

  it('skips the workspace check on routes without a workspaceId param', () => {
    const guard = makeGuard({});
    const request = validRequest({ params: {} });

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('403 FORBIDDEN when a required action is missing from X-Actions', () => {
    const guard = makeGuard({ required: ['approval:decide'] });
    const request = validRequest();

    const error = catchApiError(() => guard.canActivate(makeContext(request)));
    expect(error.getStatus()).toBe(403);
    expect((error.getResponse() as { message: string }).message).toContain(
      'approval:decide',
    );
  });

  it('403 FORBIDDEN when X-Actions is absent but actions are required', () => {
    const guard = makeGuard({ required: ['approval:read'] });
    const request = validRequest();
    delete request.headers['x-actions'];

    expectApiError(
      () => guard.canActivate(makeContext(request)),
      403,
      'FORBIDDEN',
    );
  });

  it('populates request.auth on success', () => {
    const guard = makeGuard({ required: ['approval:read'] });
    const request = validRequest();

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.auth).toEqual({
      userId: 'usr_1',
      workspaceId: 'ws_1',
      actions: ['approval:read', 'approval:create'],
    });
  });

  it('trims whitespace and drops empty entries when parsing X-Actions', () => {
    const guard = makeGuard({ required: ['approval:cancel'] });
    const request = validRequest();
    request.headers['x-actions'] = ' approval:cancel , ,approval:read ';

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.auth?.actions).toEqual(['approval:cancel', 'approval:read']);
  });

  it('uses the first value when an auth header arrives as an array', () => {
    const guard = makeGuard({});
    const request = validRequest();
    request.headers['x-user-id'] = ['usr_1', 'usr_2'];

    expect(guard.canActivate(makeContext(request))).toBe(true);
    expect(request.auth?.userId).toBe('usr_1');
  });
});
