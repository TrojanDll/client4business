import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext } from './auth-context';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!request.auth) {
      throw new Error(
        'AuthContext is missing; AuthGuard must run before @CurrentAuth()',
      );
    }
    return request.auth;
  },
);
