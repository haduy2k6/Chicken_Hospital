import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseSupportModule } from '../case-support/case-support.module.js';
import { DoctorProfile } from '../entities/doctor.entity.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { DoctorController } from './doctor.controller.js';
import { DoctorService } from './doctor.service.js';
import { VerifiedDoctorGuard } from './guards/verified-doctor.guard.js';
import { PublicDoctorsController } from './public-doctors.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([DoctorProfile]), CaseSupportModule, SchedulingModule],
  controllers: [DoctorController, PublicDoctorsController],
  providers: [DoctorService, VerifiedDoctorGuard],
})
export class DoctorModule {}
