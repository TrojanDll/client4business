import { Controller, Get, HttpStatus } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Database is not reachable',
      );
    }
    return { status: 'ready' };
  }
}
