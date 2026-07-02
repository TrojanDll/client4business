import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/auth-context';
import { CurrentAuth } from '../auth/current-auth.decorator';
import { RequireActions } from '../auth/require-actions.decorator';
import { ApiError } from '../common/api-error';
import { IdempotencyService } from '../idempotency/idempotency.service';
import {
  ApprovalRequestDetailView,
  ApprovalRequestListView,
  ApprovalsService,
  DecisionInput,
} from './approvals.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import {
  ApproveRequestDto,
  CancelRequestDto,
  RejectRequestDto,
} from './dto/decision.dto';
import { ListApprovalRequestsDto } from './dto/list-approval-requests.dto';

const requestIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new ApiError(
      HttpStatus.NOT_FOUND,
      'NOT_FOUND',
      'Approval request not found',
    ),
});

@Controller('workspaces/:workspaceId/approval-requests')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @RequireActions('approval:create')
  async create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateApprovalRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.idempotency.execute(
      auth,
      request,
      async (tx) => ({
        status: HttpStatus.CREATED,
        body: await this.approvals.create(auth, dto, tx),
      }),
    );
    response.status(result.status);
    return result.body;
  }

  @Get()
  @RequireActions('approval:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListApprovalRequestsDto,
  ): Promise<ApprovalRequestListView> {
    return this.approvals.list(auth, query);
  }

  @Get(':requestId')
  @RequireActions('approval:read')
  getById(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId', requestIdPipe) requestId: string,
  ): Promise<ApprovalRequestDetailView> {
    return this.approvals.getById(auth, requestId);
  }

  @Post(':requestId/approve')
  @RequireActions('approval:decide')
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId', requestIdPipe) requestId: string,
    @Body() dto: ApproveRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.decide(auth, requestId, request, response, {
      status: 'approved',
      comment: dto.comment,
    });
  }

  @Post(':requestId/reject')
  @RequireActions('approval:decide')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId', requestIdPipe) requestId: string,
    @Body() dto: RejectRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.decide(auth, requestId, request, response, {
      status: 'rejected',
      reason: dto.reason,
    });
  }

  @Post(':requestId/cancel')
  @RequireActions('approval:cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('requestId', requestIdPipe) requestId: string,
    @Body() dto: CancelRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    return this.decide(auth, requestId, request, response, {
      status: 'canceled',
      reason: dto.reason,
    });
  }

  private async decide(
    auth: AuthContext,
    requestId: string,
    request: Request,
    response: Response,
    decision: DecisionInput,
  ): Promise<unknown> {
    const result = await this.idempotency.execute(
      auth,
      request,
      async (tx) => ({
        status: HttpStatus.OK,
        body: await this.approvals.decide(auth, requestId, decision, tx),
      }),
    );
    response.status(result.status);
    return result.body;
  }
}
