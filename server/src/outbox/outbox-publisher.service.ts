import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.publishPending(),
      POLL_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async publishPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      });
      for (const event of events) {
        // stdout log stands in for a real message broker
        this.logger.log(
          `outbox event ${event.eventType}: ${JSON.stringify(event.payload)}`,
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
