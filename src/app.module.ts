import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { TracksController } from './tracks/tracks.controller';
import { MediaController } from './media/media.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [PrismaModule, AdminModule],
  controllers: [HealthController, CatalogController, TracksController, MediaController],
  providers: [CatalogService]
})
export class AppModule {}
