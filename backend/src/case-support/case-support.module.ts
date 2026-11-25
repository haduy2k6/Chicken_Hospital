import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiAnalysis } from '../entities/ai-analysis.entity.js';
import { AuditLog } from '../entities/audit-log.entity.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AiCallbackController } from './ai-callback.controller.js';
import { AiCallbackGuard } from './guards/ai-callback.guard.js';
import { AuditService } from './audit.service.js';
import { StorageService } from './storage.service.js';

/** Dịch vụ dùng chung cho patient và doctor: lưu ảnh, điều phối AI (client mỏng), nhật ký truy vết */
@Module({
  imports: [TypeOrmModule.forFeature([AiAnalysis, AuditLog])],
  controllers: [AiCallbackController],
  providers: [StorageService, AiAnalysisService, AuditService, AiCallbackGuard],
  exports: [StorageService, AiAnalysisService, AuditService],
})
export class CaseSupportModule {}
