import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { TracksController } from './tracks/tracks.controller';
import { MediaController } from './media/media.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { AuthenticationGuard } from './auth/authentication.guard';
import { RolesGuard } from './auth/roles.guard';
import { SecurityModule } from './config/security.module';

@Module({
  imports: [
    SecurityModule,
    PrismaModule,
    // Techo general contra el abuso automatizado. Los endpoints que cuestan
    // caro —los de contraseña— aprietan mucho más con `@Throttle`.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    MeModule,
    AdminModule
  ],
  controllers: [HealthController, CatalogController, TracksController, MediaController],
  providers: [
    CatalogService,
    // El orden importa y es el de esta lista: primero se frena al que llama
    // demasiado, después se comprueba quién es, y solo entonces si puede. Así
    // una avalancha de logins falsos no llega nunca a gastar CPU en argon2.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule {}
