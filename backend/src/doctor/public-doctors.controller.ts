import { Controller, Get, Header } from '@nestjs/common';
import { DoctorService } from './doctor.service.js';

@Controller('doctors')
export class PublicDoctorsController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  list() {
    return this.doctorService.publicDoctors();
  }
}
