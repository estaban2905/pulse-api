import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminTokenGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AdminTokenGuard]
})
export class AdminModule {}
