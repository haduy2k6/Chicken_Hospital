// src/case-support/ai-analysis.service.ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { Redis } from '@upstash/redis';
import { AiAnalysis, AnalysisStatus } from '../entities/ai-analysis.entity.js';
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

interface RedisJobMeta {
  analysisId: string;
  caseId: string;
  imageKey: string;
  mimeType: string;
  subStatus: 'pending' | 'dispatched';
  dispatchedAt: number | null;
  retryCount: number;
  nextAttemptAt: number | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Full jitter: các instance không cùng gửi lại một lúc. */
const backoffMs = (attempt: number) => Math.round(Math.random() * Math.min(60_000, 5_000 * 2 ** (attempt - 1)));

const REDIS_QUEUE_KEY = 'ai:queue:jobs';
const REDIS_LOCK_KEY = 'ai:lock:dispatcher';
const REDIS_CB_STATE_KEY = 'ai:circuit:state';
const REDIS_CB_OPEN_UNTIL_KEY = 'ai:circuit:open_until';
const REDIS_CB_FAILURES_KEY = 'ai:circuit:failures';
const REDIS_JOB_PREFIX = 'ai:job:';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly submitTimeoutMs: number;
  private readonly pacingMs: number;
  private readonly batchPerRun: number;
  private readonly resubmitCooldownMs: number;
  private readonly maxRetry: number;
  private readonly failAfterMs: number;
  private readonly circuitBaseMs: number;
  private readonly circuitMaxMs: number;
  private readonly healthTimeoutMs: number;
  private readonly lockTtlSec: number;
  private readonly releaseLockScript: { exec(keys: string[], args: string[]): Promise<number> };

  // Circuit Breaker in-memory state (kèm đồng bộ Redis)
  private cbState: CircuitState = 'CLOSED';
  private cbOpenUntil = 0;
  private cbFailures = 0;

  // Worker lock & in-memory queue fallback
  private isWorkerActive = false;
  private inMemoryQueue: string[] = [];
  private inMemoryJobMeta = new Map<string, RedisJobMeta>();
  private reconciling = false;

  constructor(
    config: ConfigService,
    @InjectRepository(AiAnalysis) private readonly repo: Repository<AiAnalysis>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    @Inject(UPSTASH_REDIS) private readonly redis: Redis,
  ) {
    const num = (key: string, fallback: number) => {
      const value = Number(config.get(key));
      return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    this.baseUrl = config.get<string>('AI_SERVICE_URL')?.replace(/\/$/, '');
    this.apiKey = config.get<string>('AI_SERVICE_KEY');
    this.submitTimeoutMs = num('AI_SUBMIT_TIMEOUT_MS', 12_000);
    this.pacingMs = num('AI_DISPATCH_PACING_MS', 8_000);
    this.batchPerRun = Math.floor(num('AI_DISPATCH_BATCH_PER_RUN', 5));
    this.resubmitCooldownMs = num('AI_RESUBMIT_COOLDOWN_MS', 10 * 60 * 1000);
    this.maxRetry = Math.floor(num('AI_MAX_RETRY', 2));
    this.failAfterMs = num('AI_FAIL_AFTER_MS', 45 * 60 * 1000);
    this.circuitBaseMs = num('AI_CIRCUIT_BASE_OPEN_MS', 60_000);
    this.circuitMaxMs = num('AI_CIRCUIT_MAX_OPEN_MS', 600_000);
    this.healthTimeoutMs = num('AI_HEALTH_TIMEOUT_MS', 10_000);
    this.lockTtlSec = Math.ceil(num('AI_DISPATCH_LOCK_TTL_SEC', 300_000) / 1000);
    this.releaseLockScript = this.redis.createScript<number>(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    );
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

  /** Redis lỗi thì không dispatch: cron sẽ thử lại, tránh N instance cùng gửi job. */
  private async acquireLock(key: string): Promise<string | null> {
    try {
      const token = randomUUID();
      const res = await this.redis.set(key, token, { nx: true, ex: this.lockTtlSec });
      return res === 'OK' ? token : null;
    } catch {
      return null;
    }
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.releaseLockScript.exec([key], [token]);
    } catch {
      /* Khóa tự hết hạn qua TTL */
    }
  }

  private async getJobMeta(analysisId: string): Promise<RedisJobMeta | null> {
    try {
      const raw = await this.redis.get<string>(`${REDIS_JOB_PREFIX}${analysisId}`);
      if (raw) return typeof raw === 'string' ? JSON.parse(raw) : (raw as RedisJobMeta);
    } catch {
      /* Fallback to memory */
    }
    return this.inMemoryJobMeta.get(analysisId) ?? null;
  }

  private async saveJobMeta(analysisId: string, meta: RedisJobMeta): Promise<void> {
    this.inMemoryJobMeta.set(analysisId, meta);
    try {
      await this.redis.set(`${REDIS_JOB_PREFIX}${analysisId}`, JSON.stringify(meta), { ex: 86400 });
    } catch {
      /* Bỏ qua lỗi Redis */
    }
  }

  private async deleteJobMeta(analysisId: string): Promise<void> {
    this.inMemoryJobMeta.delete(analysisId);
    try {
      await this.redis.del(`${REDIS_JOB_PREFIX}${analysisId}`);
    } catch {
      /* Bỏ qua lỗi Redis */
    }
  }

  // ------------------------------------------------------------ Circuit Breaker

  private async isCircuitOpen(): Promise<boolean> {
    try {
      const [remoteState, remoteUntil, remoteFailures] = await Promise.all([
        this.redis.get<string>(REDIS_CB_STATE_KEY),
        this.redis.get<string | number>(REDIS_CB_OPEN_UNTIL_KEY),
        this.redis.get<string | number>(REDIS_CB_FAILURES_KEY),
      ]);
      if (remoteState) this.cbState = remoteState as CircuitState;
      if (remoteUntil) this.cbOpenUntil = Number(remoteUntil);
      if (remoteFailures !== null) this.cbFailures = Number(remoteFailures) || 0;
    } catch {
      /* Dùng state trong bộ nhớ */
    }

    if (this.cbState === 'OPEN') {
      const now = Date.now();
      if (now < this.cbOpenUntil) {
        return true;
      }
      this.cbState = 'HALF_OPEN';
      void this.syncCircuitState('HALF_OPEN', 0, this.cbFailures);
      this.logger.log('Circuit Breaker chuyển sang HALF-OPEN. Sẽ kiểm tra GET /health trước khi gửi job.');
      return false;
    }

    return false;
  }

  private async tripCircuitBreaker(reason: string): Promise<void> {
    this.cbFailures += 1;
    const ceiling = Math.min(
      this.circuitMaxMs,
      this.circuitBaseMs * Math.pow(2, Math.max(0, this.cbFailures - 1)),
    );
    const duration = Math.round(ceiling * (0.5 + Math.random() / 2));
    this.cbOpenUntil = Date.now() + duration;
    this.cbState = 'OPEN';

    this.logger.warn(
      `AI Circuit Breaker BẬT (OPEN) trong ${(duration / 1000).toFixed(1)}s (lần lỗi ${this.cbFailures}) do: ${reason}`,
    );
    await this.syncCircuitState('OPEN', this.cbOpenUntil, this.cbFailures, Math.ceil(this.circuitMaxMs / 1000) + 60);
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
        signal: AbortSignal.timeout(this.healthTimeoutMs),
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
    this.logger.log(`Xếp ${jobs.length} job AI vào hàng đợi tuần tự Redis`);

    void (async () => {
      for (const job of jobs) {
        await this.saveJobMeta(job.analysisId, {
          analysisId: job.analysisId,
          caseId: job.caseId,
          imageKey: job.imageKey,
          mimeType: job.mimeType,
          subStatus: 'pending',
          dispatchedAt: null,
          retryCount: 0,
          nextAttemptAt: null,
        });
        this.inMemoryQueue.push(job.analysisId);
        await this.redisPush(REDIS_QUEUE_KEY, job.analysisId);
      }
      await this.triggerWorker();
    })().catch((err) => this.logger.error(`submit() lỗi: ${(err as Error).message}`));
  }

  private async triggerWorker(): Promise<void> {
    if (this.isWorkerActive) return;

    const token = await this.acquireLock(REDIS_LOCK_KEY);
    if (!token) return; // Worker khác đang giữ lease

    this.isWorkerActive = true;
    try {
      for (let sent = 0; sent < this.batchPerRun; sent++) {
        if (await this.isCircuitOpen()) {
          this.logger.log('Circuit Breaker đang MỞ (OPEN). Tạm dừng gửi job AI.');
          break;
        }

        if (this.cbState === 'HALF_OPEN' && !(await this.checkHealth())) {
          await this.tripCircuitBreaker('Health check thất bại trong trạng thái HALF-OPEN');
          break;
        }

        const job = await this.getNextJob();
        if (!job) break;

        const result = await this.dispatchOne(job);
        if (result.type === 'accepted') await this.onDispatchSuccess();
        if (result.type === 'circuit_trip') {
          await this.tripCircuitBreaker(result.error ?? 'Lỗi kết nối / 503');
          break;
        }

        // Mọi lần gửi đều có nhịp nghỉ; job lỗi vẫn nằm trong meta với nextAttemptAt.
        await sleep(this.pacingMs);
      }
    } catch (err) {
      this.logger.error(`Lỗi không mong muốn trong worker: ${(err as Error).message}`);
    } finally {
      this.isWorkerActive = false;
      await this.releaseLock(REDIS_LOCK_KEY, token);
    }
  }

  private jobOf(meta: RedisJobMeta): AnalysisJob {
    return {
      analysisId: meta.analysisId,
      caseId: meta.caseId,
      imageKey: meta.imageKey,
      mimeType: meta.mimeType,
    };
  }

  /** Chỉ gửi lại khi hết cooldown, hết backoff và chưa vượt số lần thử. */
  private canDispatch(meta: RedisJobMeta, now: number): boolean {
    if (meta.subStatus === 'pending') return true;
    if (meta.retryCount >= this.maxRetry) return false;
    const cooled = meta.dispatchedAt === null || now - meta.dispatchedAt >= this.resubmitCooldownMs;
    return cooled && (meta.nextAttemptAt === null || now >= meta.nextAttemptAt);
  }

  private async getNextJob(): Promise<AnalysisJob | null> {
    const now = Date.now();

    while (true) {
      const poppedId = (await this.redisPop(REDIS_QUEUE_KEY)) || this.inMemoryQueue.shift();
      if (!poppedId) break;

      const meta = await this.getJobMeta(poppedId);
      const dbRow = await this.repo.findOne({ where: { id: poppedId } });
      if (dbRow?.status === AnalysisStatus.PROCESSING && meta && this.canDispatch(meta, now)) {
        return this.jobOf(meta);
      }
    }

    // Redis queue rỗng: đối soát các job PROCESSING còn tồn trong DB.
    const stuck = await this.repo.find({
      where: { status: AnalysisStatus.PROCESSING },
      relations: { image: true },
      order: { createdAt: 'ASC' },
      take: 15,
    });

    for (const a of stuck) {
      if (!a.image) continue;
      const meta = await this.getJobMeta(a.id) ?? {
        analysisId: a.id,
        caseId: a.caseId,
        imageKey: a.image.storageKey,
        mimeType: a.image.mimeType,
        subStatus: 'pending' as const,
        dispatchedAt: null,
        retryCount: 0,
        nextAttemptAt: null,
      };

      if (meta.subStatus === 'dispatched' && meta.retryCount >= this.maxRetry
        && now - (meta.dispatchedAt ?? 0) >= this.resubmitCooldownMs) {
        await this.markFailed(a.id, `Vượt quá số lần thử lại tối đa (${this.maxRetry} lần)`);
        await this.deleteJobMeta(a.id);
        continue;
      }
      if (!this.canDispatch(meta, now)) continue;
      if (meta.dispatchedAt === null && meta.retryCount === 0 && !this.inMemoryJobMeta.has(a.id)) {
        await this.saveJobMeta(a.id, meta);
      }
      return this.jobOf(meta);
    }

    return null;
  }

  private async dispatchOne(job: AnalysisJob): Promise<{ type: 'accepted' | 'circuit_trip' | 'fatal' | 'skipped'; error?: string }> {
    if (!this.baseUrl || !this.apiKey) {
      await this.markFailed(job.analysisId, 'AI_SERVICE_URL / AI_SERVICE_KEY chưa được cấu hình');
      return { type: 'fatal' };
    }

    // Kiểm tra lại trạng thái DB
    const current = await this.repo.findOne({ where: { id: job.analysisId } });
    if (!current || current.status !== AnalysisStatus.PROCESSING) {
      return { type: 'skipped' };
    }

    const meta = (await this.getJobMeta(job.analysisId)) ?? {
      ...job,
      subStatus: 'pending' as const,
      dispatchedAt: null,
      retryCount: 0,
      nextAttemptAt: null,
    };

    const retryable = async (error: string) => {
      meta.retryCount += 1;
      if (meta.retryCount >= this.maxRetry) {
        await this.markFailed(job.analysisId, `${error} (đã thử ${meta.retryCount} lần)`);
        return { type: 'fatal' as const };
      }
      const now = Date.now();
      meta.subStatus = 'dispatched';
      meta.dispatchedAt = meta.dispatchedAt ?? now;
      meta.nextAttemptAt = now + backoffMs(meta.retryCount);
      await this.saveJobMeta(job.analysisId, meta);
      return { type: 'circuit_trip' as const, error };
    };

    try {
      this.logger.log(`Gửi job AI ${job.analysisId} đến ${this.baseUrl}/jobs (lần gửi ${meta.retryCount + 1})`);
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

      // 202 Accepted (hoặc Duplicate analysis accepted) -> Tiếp nhận hợp lệ
      if (res.status === 202) {
        meta.subStatus = 'dispatched';
        meta.dispatchedAt = Date.now();
        meta.retryCount += 1;
        meta.nextAttemptAt = null;
        await this.saveJobMeta(job.analysisId, meta);
        return { type: 'accepted' };
      }

      if (res.status === 503 || res.status === 429 || res.status === 408) {
        return retryable(`Dịch vụ AI trả về HTTP ${res.status}`);
      }

      // 4xx vĩnh viễn (sai auth, bad request) -> đánh dấu FAILED
      if (res.status >= 400 && res.status < 500) {
        await this.markFailed(job.analysisId, `Dịch vụ AI từ chối job (HTTP ${res.status})`);
        return { type: 'fatal' };
      }

      return retryable(`Dịch vụ AI lỗi máy chủ HTTP ${res.status}`);
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.warn(`Gửi job ${job.analysisId} thất bại: ${errorMsg}`);
      return retryable(errorMsg);
    }
  }

  // ------------------------------------------------------------ Nhận kết quả từ AI (callback)

  async handleResult(dto: AiResult): Promise<void> {
    const analysis = await this.repo.findOne({ where: { id: dto.analysis_id } });

    // Ca đã bị xóa trong lúc AI chạy: dọn Grad-CAM mồ côi
    if (!analysis) {
      if (dto.gradcam_key && GRADCAM_KEY_RE.test(dto.gradcam_key)) await this.storage.removeMany([dto.gradcam_key]);
      await this.deleteJobMeta(dto.analysis_id);
      return;
    }
    if (analysis.status === AnalysisStatus.COMPLETED) {
      await this.deleteJobMeta(dto.analysis_id);
      return; // callback lặp: idempotent
    }

    if (dto.status === 'failed') {
      await this.markFailed(analysis.id, dto.error_message ?? 'Dịch vụ AI xử lý thất bại');
      await this.deleteJobMeta(analysis.id);
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
        status: In([AnalysisStatus.PROCESSING, AnalysisStatus.FAILED]),
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

    await this.deleteJobMeta(analysis.id);

    if (!res.affected) {
      if (gradcamKey) await this.storage.removeMany([gradcamKey]);
      return;
    }
    await this.refreshCaseScore(analysis.caseId);
  }

  private async markFailed(analysisId: string, message: string): Promise<void> {
    try {
      await this.repo.update(
        { id: analysisId, status: AnalysisStatus.PROCESSING },
        { status: AnalysisStatus.FAILED, errorMessage: message.slice(0, 1000) },
      );
      await this.deleteJobMeta(analysisId);
    } catch (err) {
      this.logger.error(`Không cập nhật được trạng thái failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------ Đối soát định kỳ (Reconcile)

  @Cron('*/20 * * * * *') // Mỗi 20s kiểm tra dọn job kẹt và kích hoạt hàng đợi
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const now = Date.now();
      const failBefore = new Date(now - this.failAfterMs);

      // Quá hạn vẫn đánh dấu FAILED; callback muộn có thể hồi sinh nhờ update có điều kiện.
      await this.repo.update(
        {
          status: AnalysisStatus.PROCESSING,
          createdAt: LessThan(failBefore),
        },
        { status: AnalysisStatus.FAILED, errorMessage: `Quá thời gian xử lý (${Math.round(this.failAfterMs / 60_000)} phút)` },
      );

      // 2. Nếu Circuit Breaker đang OPEN thì không kích hoạt gửi thêm
      if (await this.isCircuitOpen()) return;

      // 3. Kích hoạt worker kiểm tra hàng đợi tuần tự
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
