// src/case-support/ai-analysis.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Redis } from '@upstash/redis';
import { AiAnalysis, AnalysisStatus } from '../Entity-User/AiAnalysis.entity.js';
import { UPSTASH_REDIS } from '../redis/redis.provider.js';
import { StorageService } from './storage.service.js';

export const MALIGNANT_LABEL = 'malignant';

/** Nest QUY ĐỊNH khóa; FastAPI chỉ ghi đúng khóa này vào bucket chung rồi trả lại */
export const gradcamKeyFor = (caseId: string, analysisId: string) => `cases/${caseId}/gradcam/${analysisId}.png`;
const GRADCAM_KEY_RE = /^cases\/[0-9a-f-]{36}\/gradcam\/[0-9a-f-]{36}\.png$/;

export interface AnalysisJob {
  analysisId: string;
  caseId: string;
  /** Ảnh gốc đã nằm trong bucket, FastAPI tự đọc theo khóa */
  imageKey: string;
  mimeType: string;
}

/** Body FastAPI gọi về POST /internal/ai/result */
export interface AiResult {
  analysis_id: string;
  status: 'completed' | 'failed';
  model_name?: string;
  model_version?: string;
  predicted_label?: string;
  probabilities?: Record<string, number>;
  risk_score?: number;
  gradcam_key?: string;
  raw_output?: Record<string, unknown>;
  error_message?: string;
}

const RESUBMIT_COOLDOWN_MS = 3 * 60 * 1000; // 3 phút cooldown trước khi gửi lại job đã dispatched
const MAX_RETRY = 3; // Tối đa 3 lần retry
const FAIL_AFTER_MS = 30 * 60 * 1000; // Quá 30 phút không xong thì đánh dấu FAILED
const PACING_DELAY_MS = 2000; // Nghỉ 2s giữa các lần gửi job liên tiếp
const BASE_CIRCUIT_OPEN_MS = 30 * 1000; // 30s mở mạch cơ bản
const MAX_CIRCUIT_OPEN_MS = 120 * 1000; // Tối đa 2 phút mở mạch
const HEALTH_TIMEOUT_MS = 10 * 1000; // 10s timeout cho kiểm tra /health

const REDIS_QUEUE_KEY = 'ai:queue:jobs';
const REDIS_LOCK_KEY = 'ai:lock:dispatcher';
const REDIS_CB_STATE_KEY = 'ai:circuit:state';
const REDIS_CB_OPEN_UNTIL_KEY = 'ai:circuit:open_until';
const REDIS_CB_FAILURES_KEY = 'ai:circuit:failures';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly submitTimeoutMs: number;

  // Circuit Breaker in-memory state (kèm đồng bộ Redis)
  private cbState: CircuitState = 'CLOSED';
  private cbOpenUntil = 0;
  private cbFailures = 0;

  // Worker lock & in-memory queue fallback
  private isWorkerActive = false;
  private inMemoryQueue: AnalysisJob[] = [];
  private reconciling = false;

  constructor(
    config: ConfigService,
    @InjectRepository(AiAnalysis) private readonly repo: Repository<AiAnalysis>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    @Inject(UPSTASH_REDIS) private readonly redis: Redis,
  ) {
    this.baseUrl = config.get<string>('AI_SERVICE_URL')?.replace(/\/$/, '');
    this.apiKey = config.get<string>('AI_SERVICE_KEY');
    this.submitTimeoutMs = Number(config.get('AI_SUBMIT_TIMEOUT_MS') ?? 25_000);
  }

  // ------------------------------------------------------------ Redis helpers với graceful fallback

  private async redisPush(key: string, value: string): Promise<void> {
    try {
      await this.redis.rpush(key, value);
    } catch (err) {
      this.logger.warn(`Lỗi ghi Redis queue: ${(err as Error).message}`);
    }
  }

  private async redisPop(key: string): Promise<string | null> {
    try {
      const res = await this.redis.lpop<string>(key);
      return res ?? null;
    } catch {
      return null;
    }
  }

  private async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const res = await this.redis.set(key, '1', { nx: true, ex: ttlSeconds });
      return res === 'OK';
    } catch {
      // Fallback: cho phép chạy đơn tiến trình tại instance hiện hành
      return true;
    }
  }

  private async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      /* Khóa tự hết hạn qua TTL */
    }
  }

  // ------------------------------------------------------------ Circuit Breaker

  private async isCircuitOpen(): Promise<boolean> {
    try {
      const [remoteState, remoteUntil] = await Promise.all([
        this.redis.get<string>(REDIS_CB_STATE_KEY),
        this.redis.get<string | number>(REDIS_CB_OPEN_UNTIL_KEY),
      ]);
      if (remoteState) this.cbState = remoteState as CircuitState;
      if (remoteUntil) this.cbOpenUntil = Number(remoteUntil);
    } catch {
      /* Dùng state trong bộ nhớ */
    }

    if (this.cbState === 'OPEN') {
      const now = Date.now();
      if (now < this.cbOpenUntil) {
        return true;
      }
      // Hết thời gian nghỉ -> chuyển sang HALF_OPEN để thăm dò
      this.cbState = 'HALF_OPEN';
      void this.syncCircuitState('HALF_OPEN', 0, this.cbFailures);
      this.logger.log('Circuit Breaker chuyển sang HALF-OPEN. Sẽ kiểm tra GET /health trước khi gửi job.');
      return false;
    }

    return false;
  }

  private async tripCircuitBreaker(reason: string): Promise<void> {
    this.cbFailures += 1;
    const duration = Math.min(
      MAX_CIRCUIT_OPEN_MS,
      BASE_CIRCUIT_OPEN_MS * Math.pow(2, Math.max(0, this.cbFailures - 1)),
    );
    this.cbOpenUntil = Date.now() + duration;
    this.cbState = 'OPEN';

    this.logger.warn(
      `AI Circuit Breaker BẬT (OPEN) trong ${duration / 1000}s (lần lỗi ${this.cbFailures}) do: ${reason}`,
    );
    await this.syncCircuitState('OPEN', this.cbOpenUntil, this.cbFailures, Math.ceil(duration / 1000) + 60);
  }

  private async onDispatchSuccess(): Promise<void> {
    if (this.cbState !== 'CLOSED' || this.cbFailures > 0) {
      this.cbState = 'CLOSED';
      this.cbFailures = 0;
      this.cbOpenUntil = 0;
      await this.syncCircuitState('CLOSED', 0, 0);
      this.logger.log('Circuit Breaker ĐÃ ĐÓNG (CLOSED). AI Service phản hồi bình thường.');
    }
  }

  private async syncCircuitState(state: CircuitState, openUntil: number, failures: number, ttlSeconds = 300): Promise<void> {
    try {
      const p = this.redis.pipeline();
      p.set(REDIS_CB_STATE_KEY, state, { ex: ttlSeconds });
      p.set(REDIS_CB_OPEN_UNTIL_KEY, String(openUntil), { ex: ttlSeconds });
      p.set(REDIS_CB_FAILURES_KEY, String(failures), { ex: ttlSeconds });
      await p.exec();
    } catch {
      /* Bỏ qua lỗi Redis */
    }
  }

  private async checkHealth(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      this.logger.log(`Thăm dò GET ${this.baseUrl}/health`);
      const res = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.status === 200) {
        this.logger.log('AI Service /health OK.');
        return true;
      }
      this.logger.warn(`AI Service /health trả về HTTP ${res.status}`);
      return false;
    } catch (err) {
      this.logger.warn(`AI Service /health không phản hồi: ${(err as Error).message}`);
      return false;
    }
  }

  // ------------------------------------------------------------ Hàng đợi tuần tự (Concurrency = 1)

  submit(jobs: AnalysisJob[]): void {
    if (!jobs.length) return;
    this.logger.log(`Xếp ${jobs.length} job AI vào hàng đợi tuần tự`);

    void (async () => {
      for (const job of jobs) {
        this.inMemoryQueue.push(job);
        await this.redisPush(REDIS_QUEUE_KEY, JSON.stringify(job));
      }
      await this.triggerWorker();
    })().catch((err) => this.logger.error(`submit() lỗi: ${(err as Error).message}`));
  }

  private async triggerWorker(): Promise<void> {
    if (this.isWorkerActive) return;

    const locked = await this.acquireLock(REDIS_LOCK_KEY, 45);
    if (!locked) return; // Worker khác đang xử lý luồng tuần tự

    this.isWorkerActive = true;
    try {
      while (true) {
        // 1. Kiểm tra Circuit Breaker
        if (await this.isCircuitOpen()) {
          this.logger.log('Circuit Breaker đang MỞ (OPEN). Tạm ngừng điều phối job AI.');
          break;
        }

        // 2. Nếu HALF-OPEN, bắt buộc kiểm tra /health trước
        if (this.cbState === 'HALF_OPEN') {
          const isHealthy = await this.checkHealth();
          if (!isHealthy) {
            await this.tripCircuitBreaker('Health check thất bại trong trạng thái HALF-OPEN');
            break;
          }
        }

        // 3. Lấy 1 job đủ điều kiện
        const job = await this.getNextJob();
        if (!job) break; // Hàng đợi trống

        // 4. Gửi tuần tự 1 job
        const result = await this.dispatchOne(job);

        if (result.type === 'accepted') {
          await this.onDispatchSuccess();
          // Giãn nhịp (pacing) 2s để CPU/RAM của tiến trình AI hạ nhiệt
          await new Promise((resolve) => setTimeout(resolve, PACING_DELAY_MS));
        } else if (result.type === 'circuit_trip') {
          await this.tripCircuitBreaker(result.error ?? 'Lỗi kết nối / 503');
          break; // Mạch đã mở, dừng vòng lặp gửi
        } else if (result.type === 'fatal') {
          // Lỗi 4xx vĩnh viễn đã được đánh dấu failed, chờ nhẹ rồi tiếp tục
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    } catch (err) {
      this.logger.error(`Lỗi không mong muốn trong worker: ${(err as Error).message}`);
    } finally {
      this.isWorkerActive = false;
      await this.releaseLock(REDIS_LOCK_KEY);
    }
  }

  private async getNextJob(): Promise<AnalysisJob | null> {
    // Ưu tiên 1: Lấy từ Redis queue
    const popped = await this.redisPop(REDIS_QUEUE_KEY);
    if (popped) {
      try {
        const parsed = JSON.parse(popped) as AnalysisJob;
        // Kiểm tra xem job này còn hợp lệ trong DB không
        const exists = await this.repo.findOne({
          where: { id: parsed.analysisId, status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED]) },
        });
        if (exists) return parsed;
      } catch {
        /* parse error */
      }
    }

    // Ưu tiên 2: Lấy từ inMemoryQueue fallback
    while (this.inMemoryQueue.length > 0) {
      const next = this.inMemoryQueue.shift()!;
      const exists = await this.repo.findOne({
        where: { id: next.analysisId, status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED]) },
      });
      if (exists) return next;
    }

    // Ưu tiên 3: Quét từ DB: 1 job PENDING cũ nhất
    const pending = await this.repo.findOne({
      where: { status: AnalysisStatus.PENDING },
      relations: { image: true },
      order: { createdAt: 'ASC' },
    });
    if (pending && pending.image) {
      return {
        analysisId: pending.id,
        caseId: pending.caseId,
        imageKey: pending.image.storageKey,
        mimeType: pending.image.mimeType,
      };
    }

    // Ưu tiên 4: 1 job DISPATCHED đã quá cooldown và retryCount < MAX_RETRY
    const cooldownBefore = new Date(Date.now() - RESUBMIT_COOLDOWN_MS);
    const retryable = await this.repo.findOne({
      where: {
        status: AnalysisStatus.DISPATCHED,
        dispatchedAt: LessThan(cooldownBefore),
        retryCount: LessThan(MAX_RETRY),
      },
      relations: { image: true },
      order: { dispatchedAt: 'ASC' },
    });
    if (retryable && retryable.image) {
      return {
        analysisId: retryable.id,
        caseId: retryable.caseId,
        imageKey: retryable.image.storageKey,
        mimeType: retryable.image.mimeType,
      };
    }

    return null;
  }

  private async dispatchOne(job: AnalysisJob): Promise<{ type: 'accepted' | 'circuit_trip' | 'fatal' | 'skipped'; error?: string }> {
    if (!this.baseUrl || !this.apiKey) {
      await this.markFailed(job.analysisId, 'AI_SERVICE_URL / AI_SERVICE_KEY chưa được cấu hình');
      return { type: 'fatal' };
    }

    // Kiểm tra lại trạng thái hiện tại trong DB
    const current = await this.repo.findOne({ where: { id: job.analysisId } });
    if (!current || current.status === AnalysisStatus.COMPLETED || current.status === AnalysisStatus.FAILED) {
      return { type: 'skipped' };
    }

    try {
      this.logger.log(`Gửi job AI ${job.analysisId} đến ${this.baseUrl}/jobs (retry: ${current.retryCount})`);
      const res = await fetch(`${this.baseUrl}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AI-Key': this.apiKey },
        body: JSON.stringify({
          analysis_id: job.analysisId,
          case_id: job.caseId,
          image_key: job.imageKey,
          mime_type: job.mimeType,
          gradcam_key: gradcamKeyFor(job.caseId, job.analysisId),
        }),
        signal: AbortSignal.timeout(this.submitTimeoutMs),
      });

      this.logger.log(`AI phản hồi job ${job.analysisId}: HTTP ${res.status}`);

      // 202 Accepted (kể cả Duplicate analysis accepted) -> tiếp nhận hợp lệ
      if (res.status === 202) {
        await this.repo.update(
          { id: job.analysisId, status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED]) },
          {
            status: AnalysisStatus.DISPATCHED,
            dispatchedAt: new Date(),
            retryCount: current.retryCount + 1,
          },
        );
        return { type: 'accepted' };
      }

      // 503 Quá tải / Đang khởi động lại HOẶC 429 Hàng đợi AI đầy -> Mở Circuit Breaker
      if (res.status === 503 || res.status === 429 || res.status === 408) {
        return { type: 'circuit_trip', error: `Dịch vụ AI trả về HTTP ${res.status}` };
      }

      // 4xx vĩnh viễn (sai auth, bad request) -> đánh dấu FAILED
      if (res.status >= 400 && res.status < 500) {
        await this.markFailed(job.analysisId, `Dịch vụ AI từ chối job (HTTP ${res.status})`);
        return { type: 'fatal' };
      }

      // 5xx khác
      return { type: 'circuit_trip', error: `Dịch vụ AI lỗi máy chủ HTTP ${res.status}` };
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.warn(`Gửi job ${job.analysisId} thất bại: ${errorMsg}`);
      // Lỗi mạng hoặc Timeout -> bật Circuit Breaker, không đốt quota retry
      return { type: 'circuit_trip', error: errorMsg };
    }
  }

  // ------------------------------------------------------------ Nhận kết quả từ AI (callback)

  async handleResult(dto: AiResult): Promise<void> {
    const analysis = await this.repo.findOne({ where: { id: dto.analysis_id } });

    // Ca đã bị xóa trong lúc AI chạy: dọn Grad-CAM mồ côi
    if (!analysis) {
      if (dto.gradcam_key && GRADCAM_KEY_RE.test(dto.gradcam_key)) await this.storage.removeMany([dto.gradcam_key]);
      return;
    }
    if (analysis.status === AnalysisStatus.COMPLETED) return; // callback lặp: idempotent

    if (dto.status === 'failed') {
      await this.markFailed(analysis.id, dto.error_message ?? 'Dịch vụ AI xử lý thất bại');
      return;
    }

    const raw =
      typeof dto.risk_score === 'number' ? dto.risk_score : (dto.probabilities?.[MALIGNANT_LABEL] ?? Number.NaN) * 100;
    if (!Number.isFinite(raw)) return this.markFailed(analysis.id, 'Dịch vụ AI không trả về điểm nguy cơ');
    if (!dto.model_name || !dto.model_version) {
      return this.markFailed(analysis.id, 'Dịch vụ AI không trả về tên/phiên bản model');
    }
    const riskScore = Math.min(100, Math.max(0, raw));

    // Chỉ nhận đúng khóa Nest đã quy định
    const expected = gradcamKeyFor(analysis.caseId, analysis.id);
    const gradcamKey = dto.gradcam_key === expected ? expected : null;
    if (dto.gradcam_key && !gradcamKey) this.logger.warn(`Bỏ qua gradcam_key lạ cho analysis ${analysis.id}`);

    const probabilities = Object.fromEntries(
      Object.entries(dto.probabilities ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)),
    ) as Record<string, number>;

    const res = await this.repo.update(
      {
        id: analysis.id,
        status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED, AnalysisStatus.PROCESSING, AnalysisStatus.FAILED]),
      },
      {
        status: AnalysisStatus.COMPLETED,
        riskScore,
        predictedLabel: dto.predicted_label?.slice(0, 100) ?? null,
        probabilities,
        gradcamStorageKey: gradcamKey,
        rawOutput: (dto.raw_output ?? null) as any,
        modelName: dto.model_name.slice(0, 100),
        modelVersion: dto.model_version.slice(0, 50),
        errorMessage: null,
      } as any,
    );

    if (!res.affected) {
      if (gradcamKey) await this.storage.removeMany([gradcamKey]);
      return;
    }
    await this.refreshCaseScore(analysis.caseId);
  }

  private async markFailed(analysisId: string, message: string): Promise<void> {
    try {
      await this.repo.update(
        {
          id: analysisId,
          status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED, AnalysisStatus.PROCESSING]),
        },
        { status: AnalysisStatus.FAILED, errorMessage: message.slice(0, 1000) },
      );
    } catch (err) {
      this.logger.error(`Không cập nhật được trạng thái failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------ Đối soát định kỳ (Reconcile)

  @Cron('*/20 * * * * *') // Mỗi 20s quét kiểm tra hàng đợi và dọn dẹp job kẹt
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const now = Date.now();
      const failBefore = new Date(now - FAIL_AFTER_MS);
      const cooldownBefore = new Date(now - RESUBMIT_COOLDOWN_MS);

      // 1. Quá 30 phút mà chưa xong -> Đánh dấu FAILED
      await this.repo.update(
        {
          status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED, AnalysisStatus.PROCESSING]),
          createdAt: LessThan(failBefore),
        },
        { status: AnalysisStatus.FAILED, errorMessage: 'Quá thời gian xử lý (30 phút)' },
      );

      // 2. Đã vượt quá MAX_RETRY và quá cooldown mà vẫn không có kết quả -> FAILED
      await this.repo.update(
        {
          status: In([AnalysisStatus.PENDING, AnalysisStatus.DISPATCHED]),
          retryCount: MoreThanOrEqual(MAX_RETRY),
          dispatchedAt: LessThan(cooldownBefore),
        },
        { status: AnalysisStatus.FAILED, errorMessage: `Vượt quá số lần thử lại tối đa (${MAX_RETRY} lần)` },
      );

      // 3. Nếu Circuit Breaker đang OPEN thì không kích hoạt gửi thêm
      if (await this.isCircuitOpen()) return;

      // 4. Kích hoạt worker kiểm tra hàng đợi tuần tự
      void this.triggerWorker();
    } catch (err) {
      this.logger.warn(`Đối soát AI gặp lỗi: ${(err as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  /** Điểm AI của ca = MAX điểm các ảnh đã phân tích xong (cột medical_cases.ai_risk_score) */
  private async refreshCaseScore(caseId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE "medical_cases"
          SET "ai_risk_score" = (SELECT MAX("risk_score") FROM "ai_analyses" WHERE "case_id" = $1 AND "status" = 'completed')
        WHERE "id" = $1`,
      [caseId],
    );
  }
}
