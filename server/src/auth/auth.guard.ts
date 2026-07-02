import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiError } from '../common/api-error';
import { AuthContext } from './auth-context';
import { IS_PUBLIC_KEY } from './public.decorator';
import { REQUIRED_ACTIONS_KEY } from './require-actions.decorator';

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { auth?: AuthContext }>();

    const userId = headerValue(request, 'x-user-id');
    const workspaceId = headerValue(request, 'x-workspace-id');
    if (!userId || !workspaceId) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Missing X-User-Id or X-Workspace-Id header',
      );
    }

    const params = request.params as Record<string, string | undefined>;
    const pathWorkspaceId = params.workspaceId;
    if (pathWorkspaceId !== undefined && pathWorkspaceId !== workspaceId) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Workspace access denied',
      );
    }

    const actions = (headerValue(request, 'x-actions') ?? '')
      .split(',')
      .map((action) => action.trim())
      .filter((action) => action.length > 0);

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_ACTIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const missing = required.filter((action) => !actions.includes(action));
    if (missing.length > 0) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        `Missing required action: ${missing.join(', ')}`,
      );
    }

    request.auth = { userId, workspaceId, actions };
    return true;
  }
}
