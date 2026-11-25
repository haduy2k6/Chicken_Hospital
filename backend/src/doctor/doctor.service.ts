import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, SelectQueryBuilder } from 'typeorm';
import { AiAnalysis, AnalysisStatus } from '../entities/ai-analysis.entity.js';
import { AppointmentCreator } from '../entities/appointment.entity.js';
import { CaseImage } from '../entities/case-image.entity.js';
import { DoctorProfile } from '../entities/doctor.entity.js';
import { DoctorReview, ReviewDecision } from '../entities/doctor-review.entity.js';
import { CaseStatus, MedicalCase } from '../entities/medical-case.entity.js';
import { Referral } from '../entities/referral.entity.js';
import { Specialty } from '../entities/specialty.entity.js';
import { AuditService } from '../case-support/audit.service.js';
import { INTAKE } from '../case-support/intake-schema.js';
import { StorageService } from '../case-support/storage.service.js';
import { doctorLabel } from '../common/utils/doctor-label.util.js';
import { RedisUser } from '../redis/redis.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import type { QueueQueryDto, ReviewCaseDto } from './dto/doctor.dto.js';
import { DOCTOR_CACHE } from './doctor.types.js';
import type { DoctorCtx } from './doctor.types.js';

const FORM_VERSION = 1;
const QUEUE_LIMIT = 100;
const OPEN = [CaseStatus.PENDING, CaseStatus.ESCALATED];                                            

const REFERRED_TO_ME = `EXISTS (
  SELECT 1 FROM referrals r
  WHERE r.case_id = c.id AND (r.to_doctor_id = :me OR r.to_specialty_id IN (:...sp))
    AND NOT EXISTS (SELECT 1 FROM referrals n WHERE n.case_id = r.case_id AND n.created_at > r.created_at)
)`;

type AiStatus = 'processing' | 'completed' | 'failed';
type QueueKind = 'pending' | 'escalated' | 'reviewed';
type Target = { kind: 'doctor' | 'specialty'; id: string; label: string };

interface QueueRow {
  id: string;
  status: CaseStatus;
  createdAt: Date | string;
  aiRiskScore: number | string | null;
  age: string | null;
  gender: string | null;
  name: string | null;
  specialty: string;
}

const aiStatusOf = (done: number, failed: number, total: number): AiStatus =>
  total > done + failed ? 'processing' : total === 0 || done > 0 ? 'completed' : 'failed';

const toAiStatus = (raw: string): AiStatus =>
  raw === AnalysisStatus.COMPLETED || raw === AnalysisStatus.FAILED ? raw : 'processing';

const conflict = (message: string, code: string) => new ConflictException({ message, code });
const score = (v: number | string | null) => (v == null ? null : Number(v));

@Injectable()
export class DoctorService {
  private readonly logger = new Logger(DoctorService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly scheduling: SchedulingService,
    private readonly redis: RedisUser,
  ) {}

  private scoped(d: DoctorCtx, kind: QueueKind) {
    const qb = this.ds.getRepository(MedicalCase).createQueryBuilder('c');
    if (kind === 'pending') return qb.where('c.status = :st AND c.specialtyId IN (:...sp)', { st: CaseStatus.PENDING, sp: d.specialtyIds });
    if (kind === 'escalated') return qb.where(`c.status = :st AND ${REFERRED_TO_ME}`, { st: CaseStatus.ESCALATED, me: d.id, sp: d.specialtyIds });
    return qb.where('c.status = :st AND c.assignedDoctorId = :me', { st: CaseStatus.REVIEWED, me: d.id });
  }

  private visibleTo(qb: SelectQueryBuilder<MedicalCase>, d: DoctorCtx) {
    return qb
      .andWhere(new Brackets((w) => w
        .where('c.status = :pending AND c.specialtyId IN (:...sp)')
        .orWhere('c.status = :reviewed AND c.assignedDoctorId = :me')
        .orWhere(`c.status = :esc AND ${REFERRED_TO_ME}`)))
      .setParameters({ pending: CaseStatus.PENDING, reviewed: CaseStatus.REVIEWED, esc: CaseStatus.ESCALATED, sp: d.specialtyIds, me: d.id });
  }

  private withJoins(qb: SelectQueryBuilder<MedicalCase>) {
    return qb.innerJoin('c.patient', 'p').innerJoin('p.user', 'u').innerJoin('c.specialty', 's');
  }

  private async findVisible(d: DoctorCtx, caseId: string): Promise<MedicalCase> {
    const qb = this.withJoins(this.ds.getRepository(MedicalCase).createQueryBuilder('c'))
      .select(['c.id', 'c.status', 'c.intakeData', 'c.aiRiskScore', 'c.version', 'c.createdAt'])
      .addSelect(['p.id', 'p.gender', 'u.id', 'u.name', 's.id', 's.code'])
      .where('c.id = :caseId', { caseId });
    const c = await this.visibleTo(qb, d).getOne();
    if (!c) throw new NotFoundException('Không tìm thấy ca bệnh hoặc bạn không có quyền xem');
    return c;
  }

  private queueRows(d: DoctorCtx, kind: QueueKind, specialty?: string) {
    const qb = this.withJoins(this.scoped(d, kind));
    if (specialty) qb.andWhere('s.code = :sc', { sc: specialty });
    return qb
      .select('c.id', 'id')
      .addSelect('c.status', 'status')
      .addSelect('c.createdAt', 'createdAt')
      .addSelect('c.aiRiskScore', 'aiRiskScore')
      .addSelect("c.intakeData ->> 'age'", 'age')
      .addSelect('p.gender', 'gender')
      .addSelect('u.name', 'name')
      .addSelect('s.code', 'specialty')
      .orderBy('c.aiRiskScore', 'DESC', 'NULLS LAST')
      .addOrderBy('c.createdAt', 'DESC')
      .limit(QUEUE_LIMIT)
      .getRawMany<QueueRow>();
  }

  private async openCount(d: DoctorCtx): Promise<number> {
    const count = (kind: QueueKind) => this.scoped(d, kind)
      .select('COUNT(*)', 'n')
      .getRawOne<{ n: string }>()
      .then((r) => Number(r?.n ?? 0));
    const [pending, escalated] = await Promise.all([count('pending'), count('escalated')]);
    return pending + escalated;
  }

  private async aiStatuses(caseIds: string[]): Promise<Map<string, AiStatus>> {
    if (!caseIds.length) return new Map();
    const rows = await this.ds.getRepository(AiAnalysis)
      .createQueryBuilder('a')
      .select('a.caseId', 'caseId')
      .addSelect('COUNT(*) FILTER (WHERE a.status = :done)', 'done')
      .addSelect('COUNT(*) FILTER (WHERE a.status = :failed)', 'failed')
      .addSelect('COUNT(*)', 'total')
      .where('a.caseId IN (:...ids)', { ids: caseIds })
      .setParameters({ done: AnalysisStatus.COMPLETED, failed: AnalysisStatus.FAILED })
      .groupBy('a.caseId')
      .getRawMany<{ caseId: string; done: string; failed: string; total: string }>();
    return new Map(rows.map((r) => [r.caseId, aiStatusOf(+r.done, +r.failed, +r.total)]));
  }

  async getPatientQueue(d: DoctorCtx, q: QueueQueryDto) {
    const status = q.status ?? 'all';
    const specialty = q.specialty !== 'all' ? q.specialty : undefined;
    const kinds: QueueKind[] = status === 'all' ? ['pending', 'escalated', 'reviewed'] : [status];
    const derivable = status === 'all' && !specialty;
    const [lists, counted] = await Promise.all([
      Promise.all(kinds.map((k) => this.queueRows(d, k, specialty))),
      derivable ? null : this.openCount(d),
    ]);
    const byKind = new Map(kinds.map((k, i) => [k, lists[i]] as const));
    const pending = byKind.get('pending') ?? [];
    const escalated = byKind.get('escalated') ?? [];
    const reviewed = byKind.get('reviewed') ?? [];

    const byPriority = (a: QueueRow, b: QueueRow) =>
      (score(b.aiRiskScore) ?? -1) - (score(a.aiRiskScore) ?? -1) || +new Date(b.createdAt) - +new Date(a.createdAt);
    const rows = [...[...pending, ...escalated].sort(byPriority), ...reviewed].slice(0, QUEUE_LIMIT);

    const needCount = counted === null && Math.max(pending.length, escalated.length) >= QUEUE_LIMIT;
    const [ai, extraCount] = await Promise.all([
      this.aiStatuses(rows.map((r) => r.id)),
      needCount ? this.openCount(d) : null,
    ]);
    const pendingCount = counted ?? (needCount ? extraCount! : pending.length + escalated.length);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name ?? 'Bệnh nhân',
        age: Number(r.age) || 0,
        gender: r.gender,
        specialty: r.specialty,
        submissionDate: new Date(r.createdAt).toISOString(),
        aiRiskScore: score(r.aiRiskScore),
        aiStatus: ai.get(r.id) ?? 'completed',
        status: r.status,
      })),
      pendingCount,
    };
  }

  private caseImages(caseId: string) {
    return this.ds.getRepository(CaseImage).find({
      where: { caseId },
      select: {
        id: true, kind: true, storageKey: true, createdAt: true,
        analyses: { id: true, status: true, riskScore: true, predictedLabel: true, gradcamStorageKey: true, createdAt: true },
      },
      relations: { analyses: true },
      order: { createdAt: 'ASC' },
    });
  }

  async getCaseDetails(d: DoctorCtx, caseId: string) {
    const [c, images] = await Promise.all([this.findVisible(d, caseId), this.caseImages(caseId)]);
    void this.audit.log({ actorUserId: d.userId, action: 'case.viewed', entityType: 'case', entityId: caseId, metadata: { doctorId: d.id } });

    const all = images.flatMap((i) => i.analyses);
    const ai = aiStatusOf(
      all.filter((a) => a.status === AnalysisStatus.COMPLETED).length,
      all.filter((a) => a.status === AnalysisStatus.FAILED).length,
      all.length,
    );
    const imageDtos = await Promise.all(images.map(async (img) => {
      const a = img.analyses.reduce<AiAnalysis | undefined>((m, x) => (!m || x.createdAt > m.createdAt ? x : m), undefined);
      const [url, gradcamUrl] = await Promise.all([
        this.storage.signedUrl(img.storageKey),
        a?.gradcamStorageKey ? this.storage.signedUrl(a.gradcamStorageKey) : null,
      ]);
      return {
        id: img.id,
        kind: img.kind,
        thumbUrl: url,
        url,
        analysis: a
          ? { status: toAiStatus(a.status), riskScore: a.riskScore ?? null, predictedLabel: a.predictedLabel ?? null, gradcamUrl }
          : undefined,
      };
    }));
    const symptomKeys = INTAKE[c.specialty.code]?.symptomKeys ?? [];

    return {
      id: c.id,
      name: c.patient.user?.name ?? 'Bệnh nhân',
      age: Number(c.intakeData.age) || 0,
      gender: c.patient.gender,
      specialty: c.specialty.code,
      submissionDate: c.createdAt.toISOString(),
      aiRiskScore: c.aiRiskScore ?? null,
      aiStatus: ai,
      status: c.status,
      version: c.version,
      symptoms: symptomKeys.filter((k) => c.intakeData[k] === 'Yes'),
      patientNote: null,
      intakeData: c.intakeData,
      intakeFormVersion: FORM_VERSION,
      assessmentFormVersion: FORM_VERSION,
      images: imageDtos,
    };
  }

  async reviewPatientCase(d: DoctorCtx, caseId: string, dto: ReviewCaseDto) {
    const c = await this.visibleTo(
      this.ds.getRepository(MedicalCase).createQueryBuilder('c').select(['c.id', 'c.status', 'c.patientId']).where('c.id = :caseId', { caseId }),
      d,
    ).getOne();
    if (!c) throw new NotFoundException('Không tìm thấy ca bệnh hoặc bạn không có quyền xem');
    if (!OPEN.includes(c.status)) throw conflict('Ca này đã có kết luận.', 'ALREADY_REVIEWED');

    const escalate = dto.status === 'escalated';
    const toDoctorId = escalate ? dto.referral?.toDoctorId : undefined;
    const toSpecialtyId = escalate ? dto.referral?.toSpecialtyId : undefined;
    if (escalate) await this.assertReferralTarget(d, toDoctorId, toSpecialtyId);

    const followUpAt = !escalate && dto.followUpAt ? new Date(dto.followUpAt) : undefined;
    if (followUpAt) this.scheduling.assertFollowUpTime(followUpAt);
    const notes = dto.notes.trim();

    await this.ds.transaction(async (m) => {
      const res = await m.createQueryBuilder()
        .update(MedicalCase)
        .set({ status: escalate ? CaseStatus.ESCALATED : CaseStatus.REVIEWED, assignedDoctorId: escalate ? null : d.id })
        .where('id = :id AND version = :v AND status IN (:...open)', { id: caseId, v: dto.expectedVersion, open: OPEN })
        .execute();
      if (!res.affected) throw conflict('Ca bệnh vừa được cập nhật ở nơi khác.', 'VERSION_CONFLICT');

      await m.insert(DoctorReview, {
        caseId,
        doctorId: d.id,
        decision: escalate ? ReviewDecision.ESCALATED : ReviewDecision.REVIEWED,
        notes,
        assessmentData: (dto.assessmentData ?? {}) as any,
      });
      if (escalate) {
        await m.insert(Referral, { caseId, fromDoctorId: d.id, toDoctorId: toDoctorId ?? null, toSpecialtyId: toSpecialtyId ?? null, reason: notes });
      }
      await this.audit.log(
        { actorUserId: d.userId, action: 'review.created', entityType: 'case', entityId: caseId, metadata: { doctorId: d.id, decision: dto.status } },
        m,
      );
    });

    // Đặt lịch sau khi commit: lỗi khung giờ không làm mất kết luận.
    let followUp: 'booked' | 'failed' | undefined;
    if (followUpAt) {
      try {
        await this.ds.transaction((m) => this.scheduling.reserve(m, {
          doctorId: d.id,
          patientId: c.patientId,
          caseId,
          scheduledAt: followUpAt,
          createdBy: AppointmentCreator.DOCTOR,
          note: 'Tái khám theo chỉ định của bác sĩ',
        }));
        followUp = 'booked';
      } catch (err) {
        followUp = 'failed';
        this.logger.warn(`Đặt lịch tái khám thất bại (case ${caseId}): ${(err as Error).message}`);
      }
    }

    return {
      success: true,
      followUp,
      message: escalate
        ? 'Đã chuyển tuyến ca bệnh.'
        : followUp === 'failed'
          ? 'Đã lưu kết luận nhưng chưa đặt được lịch tái khám (khung giờ đã kín hoặc trùng).'
          : 'Đã lưu kết luận.',
    };
  }

  private async assertReferralTarget(d: DoctorCtx, toDoctorId?: string, toSpecialtyId?: string) {
    if (!toDoctorId && !toSpecialtyId) throw new BadRequestException('Cần chọn bác sĩ hoặc khoa nhận khi chuyển tuyến');
    if (toDoctorId === d.id) throw new BadRequestException('Không thể chuyển tuyến cho chính mình');
    const targets = await this.targets();
    if (toDoctorId && !targets.some((t) => t.kind === 'doctor' && t.id === toDoctorId)) throw new BadRequestException('Bác sĩ nhận không hợp lệ');
    if (toSpecialtyId && !targets.some((t) => t.kind === 'specialty' && t.id === toSpecialtyId)) throw new BadRequestException('Khoa nhận không hợp lệ');
  }

  private targets(): Promise<Target[]> {
    return this.redis.remember(DOCTOR_CACHE.referralTargets, DOCTOR_CACHE.ttlSeconds, async () => {
      const [doctors, specialties] = await Promise.all([
        this.ds.getRepository(DoctorProfile).find({ where: { isVerified: true }, relations: { user: true } }),
        this.ds.getRepository(Specialty).find({ where: { isActive: true }, order: { name: 'ASC' } }),
      ]);
      return [
        ...doctors.map((x): Target => ({ kind: 'doctor', id: x.id, label: `${doctorLabel(x)}${x.hospital ? ` – ${x.hospital}` : ''}` })),
        ...specialties.map((s): Target => ({ kind: 'specialty', id: s.id, label: `Khoa ${s.name}` })),
      ];
    });
  }

  async getReferralTargets(d: DoctorCtx) {
    return (await this.targets()).filter((t) => !(t.kind === 'doctor' && t.id === d.id));
  }

  publicDoctors() {
    return this.redis.remember(DOCTOR_CACHE.publicList, DOCTOR_CACHE.ttlSeconds, async () => {
      const docs = await this.ds.getRepository(DoctorProfile).find({
        where: { isVerified: true },
        select: {
          id: true, degree: true, hospital: true, experienceYears: true, bio: true,
          user: { name: true }, specialties: { code: true, name: true },
        },
        relations: { user: true, specialties: true },
        order: { experienceYears: 'DESC' },
      });
      return docs.map((x) => ({
        id: x.id,
        name: x.user?.name ?? 'Bác sĩ',
        degree: x.degree ?? null,
        hospital: x.hospital ?? null,
        experienceYears: x.experienceYears,
        bio: x.bio ?? null,
        specialties: x.specialties.map((s) => ({ code: s.code, name: s.name })),
      }));
    });
  }

  getAvailability(d: DoctorCtx, weekStart: string) {
    return this.scheduling.getAvailability(d.id, weekStart);
  }

  setAvailability(d: DoctorCtx, dto: Parameters<SchedulingService['setAvailability']>[1]) {
    return this.scheduling.setAvailability(d.id, dto);
  }

  getAppointments(d: DoctorCtx) {
    return this.scheduling.doctorAppointments(d.id);
  }
}
