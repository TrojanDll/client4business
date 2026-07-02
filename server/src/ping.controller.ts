import { Controller, Get } from '@nestjs/common';
import type { AuthContext } from './auth/auth-context';
import { CurrentAuth } from './auth/current-auth.decorator';
import { RequireActions } from './auth/require-actions.decorator';

// Temporary auth-stub probe; to be replaced by real controllers in step 2.
@Controller('workspaces/:workspaceId/ping')
export class PingController {
  @Get()
  @RequireActions('approval:read')
  ping(@CurrentAuth() auth: AuthContext): {
    ok: true;
    userId: string;
    workspaceId: string;
  } {
    return { ok: true, userId: auth.userId, workspaceId: auth.workspaceId };
  }
}
