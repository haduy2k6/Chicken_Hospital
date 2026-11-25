import { Module } from '@nestjs/common';
import { CaseSupportModule } from '../case-support/case-support.module.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  imports: [CaseSupportModule],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
