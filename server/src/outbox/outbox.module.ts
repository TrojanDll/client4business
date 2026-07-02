import { Module } from '@nestjs/common';
import { OutboxPublisher } from './outbox-publisher.service';
import { OutboxService } from './outbox.service';

@Module({
  providers: [OutboxService, OutboxPublisher],
  exports: [OutboxService],
})
export class OutboxModule {}
