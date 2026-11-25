import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AiResultDto } from './dto/ai-result.dto.js';
import { AiCallbackGuard } from './guards/ai-callback.guard.js';

@Controller('internal/ai')
@SkipThrottle()
@UseGuards(AiCallbackGuard)
export class AiCallbackController {
  constructor(private readonly ai: AiAnalysisService) {}

  @Post('result')
  @HttpCode(200)
  async result(@Body() body: AiResultDto) {
    await this.ai.handleResult(body);
    return { ok: true };
  }
}
