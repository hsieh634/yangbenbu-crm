import { Module } from '@nestjs/common';
import { BoardEventsService } from './board-events.service';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService, BoardEventsService],
  exports: [BoardEventsService],
})
export class VisitsModule {}
