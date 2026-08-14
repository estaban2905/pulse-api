import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokensService } from './auth-tokens.service';
import { MailService } from './mail.service';
import { TokensService } from './tokens.service';

/**
 * `JwtModule` se registra sin secreto: cada firma pasa el suyo explícitamente,
 * porque access y refresh no comparten clave y un default aquí invitaría a
 * olvidarlo en alguna llamada.
 *
 * Se exporta para que el guard global, que se construye en `AppModule`, pueda
 * verificar tokens sin volver a registrar el módulo.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokensService, AuthTokensService, MailService],
  exports: [AuthService, TokensService, JwtModule]
})
export class AuthModule {}
