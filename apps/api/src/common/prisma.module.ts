import { Global, Module } from '@nestjs/common';
import { ClinicTimeService } from './clinic-time.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, ClinicTimeService],
  exports: [PrismaService, ClinicTimeService],
})
export class PrismaModule {}
