import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Between, DataSource, EntityManager, In, LessThan, Not } from 'typeorm';
import { Appointment, AppointmentCreator, AppointmentStatus } from '../entities/appointment.entity.js';
import { DoctorProfile } from '../entities/doctor.entity.js';
import { DoctorAvailability } from '../entities/doctor-availability.entity.js';
import { CaseStatus, MedicalCase } from '../entities/medical-case.entity.js';
import { AuditService } from '../case-support/audit.service.js';
import {
  SESSION_HOURS, WorkSession, addDays, isIsoDate, sessionOf, toVnDate, vnDateTime,
} from '../common/utils/app-time.util.js';
import { doctorLabel } from '../common/utils/doctor-label.util.js';
import type { AvailableDoctorsQuery, BookAppointmentDto, SetAvailabilityDto } from './dto/scheduling.dto.js';

/** Lịch đang chiếm khung giờ / chiếm hồ sơ (khớp partial unique index) */
const ACTIVE = [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED];
/** Lịch tính vào trần số ca/ngày: mọi lịch chưa hủy, kể cả đã tự hoàn tất sau giờ hẹn */
const COUNTED = Not(AppointmentStatus.CANCELLED);
const BOOK_AHEAD_DAYS = 14;
const FOLLOW_UP_MAX_DAYS = 90;
const AVAILABILITY_MAX_DAYS = 60;
/** Lịch quá giờ hẹn ngần này thì tự chuyển sang "hoàn tất" để giải phóng hạn mức của bệnh nhân */
const AUTO_COMPLETE_AFTER_MS = 2 * 3600_000;
const CASE_UNIQUE = 'uq_appt_case_active';

const slotTaken = () =>
  new ConflictException({
    message: 'Khung giờ hẹn đã có lịch hoặc bác sĩ đã đủ số lịch trong ngày. Hãy chọn giờ khác.',
    code: 'SLOT_TAKEN',
  });
const alreadyBooked = () => new ConflictException({ message: 'Hồ sơ này đã có lịch hẹn còn hiệu lực', code: 'ALREADY_BOOKED' });

@Injectable()
export class SchedulingService {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ dùng chung

  /** Khóa dòng bác sĩ (kèm user để dựng nhãn). FOR UPDATE OF d: không khóa dòng user. */
  private async lockDoctor(m: EntityManager, doctorId: string): Promise<DoctorProfile> {
    const doctor = await m
      .createQueryBuilder(DoctorProfile, 'd')
      .innerJoinAndSelect('d.user', 'u')
      .setLock('pessimistic_write', undefined, ['d'])
      .where('d.id = :id', { id: doctorId })
      .getOne();
    if (!doctor) throw new NotFoundException('Không tìm thấy bác sĩ');
    return doctor;
  }

  /**
   * Tạo lịch hẹn trong transaction của người gọi. Dòng bác sĩ được khóa để trần số ca/ngày không bị đua
   * (người gọi đã khóa sẵn thì truyền `locked` vào); partial unique index chặn trùng giờ và trùng hồ sơ.
   */
  async reserve(
    m: EntityManager,
    a: { doctorId: string; patientId: string; caseId: string | null; scheduledAt: Date; createdBy: AppointmentCreator; note?: string },
    locked?: DoctorProfile,
  ): Promise<Appointment> {
    const doctor = locked ?? (await this.lockDoctor(m, a.doctorId));

    const appointmentDate = toVnDate(a.scheduledAt);
    const count = await m.count(Appointment, { where: { doctorId: a.doctorId, appointmentDate, status: COUNTED } });
    if (count >= doctor.maxAppointmentsPerDay) throw slotTaken();

    try {
      return await m.save(
        m.create(Appointment, {
          doctorId: a.doctorId,
          patientId: a.patientId,
          caseId: a.caseId,
          scheduledAt: a.scheduledAt,
          appointmentDate,
          createdBy: a.createdBy,
          note: a.note,
        }),
      );
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e?.code === '23505') throw e.constraint === CASE_UNIQUE ? alreadyBooked() : slotTaken();
      throw err;
    }
  }

  /** Giờ tái khám bác sĩ chỉ định: ở tương lai gần và trùng đúng một khung giờ làm việc */
  assertFollowUpTime(at: Date) {
    const now = Date.now();
    if (at.getTime() <= now) throw new BadRequestException('Ngày hẹn tái khám phải ở tương lai');
    if (at.getTime() > now + FOLLOW_UP_MAX_DAYS * 86_400_000) {
      throw new BadRequestException(`Ngày hẹn tái khám tối đa ${FOLLOW_UP_MAX_DAYS} ngày tới`);
    }
    const date = toVnDate(at);
    const aligned = (Object.keys(SESSION_HOURS) as WorkSession[]).some((s) =>
      SESSION_HOURS[s].some((h) => vnDateTime(date, h).getTime() === at.getTime()),
    );
    if (!aligned) throw new BadRequestException('Giờ hẹn phải trùng khung giờ làm việc');
  }

  private pickSlot(date: string, session: WorkSession, taken: Set<number>): Date | null {
    const now = Date.now();
    for (const hour of SESSION_HOURS[session]) {
      const at = vnDateTime(date, hour);
      if (at.getTime() > now && !taken.has(at.getTime())) return at;
    }
    return null;
  }

  private assertBookableDate(date: string) {
    const today = toVnDate(new Date());
    if (!isIsoDate(date) || date < today || date > addDays(today, BOOK_AHEAD_DAYS)) {
      throw new BadRequestException(`Chỉ đặt được lịch trong ${BOOK_AHEAD_DAYS} ngày tới`);
    }
  }

  private async ownedReviewedCase(m: EntityManager, userId: string, caseId: string): Promise<MedicalCase> {
    const c = await m.findOne(MedicalCase, {
      where: { id: caseId, patient: { userId } },
      select: { id: true, status: true, patientId: true, specialtyId: true },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hồ sơ');
    if (c.status !== CaseStatus.REVIEWED) throw new ConflictException('Chỉ đặt lịch được khi hồ sơ đã có kết luận');
    return c;
  }

  // ------------------------------------------------------------ vòng đời lịch hẹn

  /** Lịch đã quá giờ thì hoàn tất; nếu không, ca đã duyệt có lịch sẽ giữ hạn mức vĩnh viễn. An toàn khi chạy nhiều instance. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoComplete(): Promise<void> {
    try {
      await this.ds
        .getRepository(Appointment)
        .update({ status: In(ACTIVE), scheduledAt: LessThan(new Date(Date.now() - AUTO_COMPLETE_AFTER_MS)) }, { status: AppointmentStatus.COMPLETED });
    } catch (err) {
      this.logger.warn(`Tự hoàn tất lịch hẹn thất bại: ${(err as Error).message}`);
    }
  }

  /** Bệnh nhân hủy lịch của chính mình (chỉ lịch còn hiệu lực và chưa đến giờ). Ca vẫn "đã duyệt", đặt lại được. */
  async cancel(userId: string, appointmentId: string) {
    const res = await this.ds
      .createQueryBuilder()
      .update(Appointment)
      .set({ status: AppointmentStatus.CANCELLED, cancelledAt: () => 'now()' })
      .where(
        `id = :id AND status IN ('scheduled', 'confirmed') AND scheduled_at > now()
         AND patient_id IN (SELECT id FROM patient_profiles WHERE user_id = :userId)`,
        { id: appointmentId, userId },
      )
      .execute();
    if (!res.affected) throw new NotFoundException('Không hủy được lịch hẹn');

    void this.audit.log({ actorUserId: userId, action: 'appointment.cancelled', entityType: 'appointment', entityId: appointmentId });
    return { success: true };
  }

  // ------------------------------------------------------------ bệnh nhân

  /** Bác sĩ đã xác minh, đúng khoa của hồ sơ, đang làm việc vào ngày đó và còn khung trống */
  async availableDoctors(userId: string, q: AvailableDoctorsQuery) {
    const c = await this.ownedReviewedCase(this.ds.manager, userId, q.caseId);
    this.assertBookableDate(q.date);

    const rows = await this.ds.getRepository(DoctorAvailability).find({
      where: { workDate: q.date, doctor: { isVerified: true, specialties: { id: c.specialtyId } } },
      relations: { doctor: { user: true } },
    });
    if (!rows.length) return [];

    const ids = [...new Set(rows.map((r) => r.doctorId))];
    const booked = await this.ds.getRepository(Appointment).find({
      where: { doctorId: In(ids), appointmentDate: q.date, status: COUNTED },
      select: { doctorId: true, scheduledAt: true },
    });

    const out = [];
    for (const id of ids) {
      const mine = rows.filter((r) => r.doctorId === id);
      const doc = mine[0].doctor;
      const taken = booked.filter((b) => b.doctorId === id);
      if (taken.length >= doc.maxAppointmentsPerDay) continue;

      const takenSet = new Set(taken.map((t) => t.scheduledAt.getTime()));
      const sessions = mine.map((r) => r.session).filter((s) => this.pickSlot(q.date, s, takenSet));
      if (!sessions.length) continue;

      out.push({
        doctorId: id,
        name: doctorLabel(doc),
        hospital: doc.hospital ?? null,
        experienceYears: doc.experienceYears,
        bio: doc.bio ?? null,
        sessions,
      });
    }
    return out;
  }

  async book(userId: string, dto: BookAppointmentDto) {
    this.assertBookableDate(dto.date);

    return this.ds.transaction(async (m) => {
      // Khóa bác sĩ TRƯỚC khi đọc các slot đã đặt: hai người đặt đồng thời được xếp hàng, người sau thấy slot kế tiếp
      const doctor = await this.lockDoctor(m, dto.doctorId);
      const c = await this.ownedReviewedCase(m, userId, dto.caseId);

      // Đường nhanh cho thông báo thân thiện; chặn đua thật sự là unique index uq_appt_case_active (bắt ở reserve)
      if (await m.count(Appointment, { where: { caseId: c.id, status: In(ACTIVE) } })) throw alreadyBooked();

      const works = await m.exists(DoctorAvailability, {
        where: {
          doctorId: dto.doctorId,
          workDate: dto.date,
          session: dto.session,
          doctor: { isVerified: true, specialties: { id: c.specialtyId } },
        },
      });
      if (!works) throw new ConflictException('Bác sĩ không làm việc ở buổi này hoặc không đúng chuyên khoa');

      const taken = await m.find(Appointment, {
        where: { doctorId: dto.doctorId, appointmentDate: dto.date, status: COUNTED },
        select: { scheduledAt: true },
      });
      const at = this.pickSlot(dto.date, dto.session, new Set(taken.map((t) => t.scheduledAt.getTime())));
      if (!at) throw slotTaken();

      const appt = await this.reserve(
        m,
        { doctorId: dto.doctorId, patientId: c.patientId, caseId: c.id, scheduledAt: at, createdBy: AppointmentCreator.PATIENT, note: dto.note },
        doctor,
      );
      await this.audit.log(
        { actorUserId: userId, action: 'appointment.booked', entityType: 'appointment', entityId: appt.id, metadata: { caseId: c.id } },
        m,
      );

      return {
        id: appt.id,
        scheduledAt: appt.scheduledAt.toISOString(),
        status: appt.status,
        doctorName: doctorLabel(doctor),
        hospital: doctor.hospital ?? null,
      };
    });
  }

  // ------------------------------------------------------------ bác sĩ

  async getAvailability(doctorId: string, weekStart: string) {
    if (!isIsoDate(weekStart)) throw new BadRequestException('Ngày không hợp lệ');
    const rows = await this.ds.getRepository(DoctorAvailability).find({
      where: { doctorId, workDate: Between(weekStart, addDays(weekStart, 6)) },
      select: { workDate: true, session: true },
      order: { workDate: 'ASC' },
    });
    return rows.map((r) => ({ date: r.workDate, session: r.session }));
  }

  /** Ghi đè lịch làm việc của cả tuần (từ hôm nay trở đi) theo kiểu diff. Không cho bỏ buổi đang có lịch hẹn. */
  async setAvailability(doctorId: string, dto: SetAvailabilityDto) {
    if (!isIsoDate(dto.weekStart)) throw new BadRequestException('Ngày không hợp lệ');
    const today = toVnDate(new Date());
    if (dto.weekStart > addDays(today, AVAILABILITY_MAX_DAYS)) {
      throw new BadRequestException(`Chỉ chỉnh được lịch trong ${AVAILABILITY_MAX_DAYS} ngày tới`);
    }
    const end = addDays(dto.weekStart, 6);
    const from = dto.weekStart < today ? today : dto.weekStart;
    const keyOf = (date: string, session: string) => `${date}|${session}`;

    const wanted = new Map<string, { doctorId: string; workDate: string; session: WorkSession }>();
    for (const s of dto.slots) {
      if (!isIsoDate(s.date) || s.date < dto.weekStart || s.date > end) throw new BadRequestException('Có ngày nằm ngoài tuần đang chỉnh');
      if (s.date < today) continue;
      wanted.set(keyOf(s.date, s.session), { doctorId, workDate: s.date, session: s.session });
    }

    await this.ds.transaction(async (m) => {
      await this.lockDoctor(m, doctorId);

      const booked = await m.find(Appointment, {
        where: { doctorId, appointmentDate: Between(from, end), status: In(ACTIVE) },
        select: { scheduledAt: true },
      });
      if (booked.some((a) => !wanted.has(keyOf(toVnDate(a.scheduledAt), sessionOf(a.scheduledAt))))) {
        throw new ConflictException({
          message: 'Không thể bỏ buổi đã có lịch hẹn của bệnh nhân',
          code: 'AVAILABILITY_HAS_APPOINTMENTS',
        });
      }

      const existing = await m.find(DoctorAvailability, {
        where: { doctorId, workDate: Between(from, end) },
        select: { id: true, workDate: true, session: true },
      });
      const have = new Set(existing.map((r) => keyOf(r.workDate, r.session)));
      const removeIds = existing.filter((r) => !wanted.has(keyOf(r.workDate, r.session))).map((r) => r.id);
      const added = [...wanted].filter(([k]) => !have.has(k)).map(([, v]) => v);

      if (removeIds.length) await m.delete(DoctorAvailability, removeIds);
      if (added.length) await m.insert(DoctorAvailability, added);
    });

    return { success: true };
  }

  async doctorAppointments(doctorId: string) {
    const today = toVnDate(new Date());
    const rows = await this.ds.getRepository(Appointment).find({
      where: { doctorId, status: In(ACTIVE), appointmentDate: Between(today, addDays(today, 60)) },
      select: { id: true, scheduledAt: true, status: true, caseId: true, note: true, patient: { id: true, user: { name: true } } },
      relations: { patient: { user: true } },
      order: { scheduledAt: 'ASC' },
      take: 200,
    });
    return rows.map((a) => ({
      id: a.id,
      scheduledAt: a.scheduledAt.toISOString(),
      status: a.status,
      caseId: a.caseId,
      patientName: a.patient.user?.name ?? 'Bệnh nhân',
      note: a.note ?? null,
    }));
  }
}
