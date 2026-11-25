import 'multer';
import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query,
  UploadedFiles, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UploadErrorFilter } from '../common/filters/upload-error.filter.js';
import { isAllowedImageMime } from '../common/utils/image-type.util.js';
import { UserRole } from '../entities/user-role.enum.js';
import { AvailableDoctorsQuery, BookAppointmentDto } from '../scheduling/dto/scheduling.dto.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { PatientService } from './patient.service.js';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 4 * 1024 * 1024; // khớp MAX_MB = 4 ở DropZone

@Controller('patient')
@UseGuards(AccessGuard, RolesGuard)
@Roles([UserRole.PATIENT])
export class PatientController {
  constructor(
    private readonly patientService: PatientService,
    private readonly scheduling: SchedulingService,
  ) {}

  /** Lịch sử ca + hạn mức (nguồn sự thật duy nhất cho frontend) */
  @Get('history')
  getHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.patientService.getHistory(user.userId);
  }

  /** Gửi hồ sơ: multipart gồm "files", "specialty" và các trường form */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseFilters(UploadErrorFilter)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
      fileFilter: (_request, file, callback) =>
        isAllowedImageMime(file.mimetype)
          ? callback(null, true)
          : callback(new BadRequestException('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP'), false),
    }),
  )
  submitPatient(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
  ) {
    return this.patientService.createPatientRecord(user.userId, files ?? [], body ?? {});
  }

  /** Xác nhận đã nhận thông tin chuyển tuyến: ca bị xóa khỏi hệ thống */
  @Post('cases/:id/confirm-referral')
  confirmReferral(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.patientService.confirmReferral(user.userId, id);
  }

  @Get('doctors')
  availableDoctors(@CurrentUser() user: AuthenticatedUser, @Query() query: AvailableDoctorsQuery) {
    return this.scheduling.availableDoctors(user.userId, query);
  }

  @Post('appointments')
  book(@CurrentUser() user: AuthenticatedUser, @Body() dto: BookAppointmentDto) {
    return this.scheduling.book(user.userId, dto);
  }

  /** Hủy lịch hẹn của chính mình; hồ sơ vẫn "đã duyệt" và đặt lại được */
  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancelAppointment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.scheduling.cancel(user.userId, id);
  }
}
