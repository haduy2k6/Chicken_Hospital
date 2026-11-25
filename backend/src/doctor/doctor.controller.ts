import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UserRole } from '../entities/user-role.enum.js';
// DTO phải import giá trị (không dùng `import type`) để ValidationPipe đọc được metadata của decorator
import { SetAvailabilityDto, WeekQuery } from '../scheduling/dto/scheduling.dto.js';
import { QueueQueryDto, ReviewCaseDto } from './dto/doctor.dto.js';
import type { DoctorCtx } from './doctor.types.js';
import { DoctorService } from './doctor.service.js';
import { VerifiedDoctorGuard } from './guards/verified-doctor.guard.js';

type DoctorUser = AuthenticatedUser & { doctor: DoctorCtx };

@Controller('doctor')
@UseGuards(AccessGuard, RolesGuard, VerifiedDoctorGuard)
@Roles([UserRole.DOCTOR])
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get('queue')
  getQueue(@CurrentUser() user: DoctorUser, @Query() query: QueueQueryDto) {
    return this.doctorService.getPatientQueue(user.doctor, query);
  }

  @Get('referral-targets')
  getReferralTargets(@CurrentUser() user: DoctorUser) {
    return this.doctorService.getReferralTargets(user.doctor);
  }

  @Get('case/:id')
  getCase(@CurrentUser() user: DoctorUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.doctorService.getCaseDetails(user.doctor, id);
  }

  @Post('review/:id')
  reviewCase(
    @CurrentUser() user: DoctorUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewCaseDto,
  ) {
    return this.doctorService.reviewPatientCase(user.doctor, id, body);
  }

  @Get('availability')
  getAvailability(@CurrentUser() user: DoctorUser, @Query() query: WeekQuery) {
    return this.doctorService.getAvailability(user.doctor, query.weekStart);
  }

  @Put('availability')
  setAvailability(@CurrentUser() user: DoctorUser, @Body() body: SetAvailabilityDto) {
    return this.doctorService.setAvailability(user.doctor, body);
  }

  @Get('appointments')
  getAppointments(@CurrentUser() user: DoctorUser) {
    return this.doctorService.getAppointments(user.doctor);
  }
}
