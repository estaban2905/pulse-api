import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

import { AuthTokenKind } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityConfig } from '../config/security.config';

const TOKEN_BYTES = 32;

/** Cuánto vale cada tipo de enlace, en minutos. */
const TTL_MINUTES: Record<AuthTokenKind, number> = {
  // Corto: es la llave para entrar en una cuenta ajena si alguien lo intercepta.
  PASSWORD_RESET: 60,
  // Largo: solo confirma un buzón, y la gente lee el correo cuando puede.
  EMAIL_VERIFICATION: 60 * 24
};

/**
 * Enlaces de un solo uso que viajan por correo.
 *
 * Se guarda un HMAC y no el valor, de modo que la tabla no permite fabricar
 * enlaces válidos. Y se marcan como usados en lugar de borrarse, para poder
 * distinguir "caducado" de "ya lo usaste" sin conservar el secreto.
 */
@Injectable()
export class AuthTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SecurityConfig
  ) {}

  private fingerprint(rawToken: string): string {
    return createHmac('sha256', this.config.refreshSecret).update(rawToken, 'utf8').digest('hex');
  }

  /**
   * Emite un enlace nuevo y anula los anteriores del mismo tipo.
   *
   * Pedir otro tiene que invalidar el de antes: si no, cada solicitud dejaría
   * una llave más rondando por el buzón.
   */
  async issue(userId: string, kind: AuthTokenKind): Promise<string> {
    const rawToken = randomBytes(TOKEN_BYTES).toString('base64url');

    await this.prisma.$transaction([
      this.prisma.authToken.updateMany({
        where: { userId, kind, usedAt: null },
        data: { usedAt: new Date() }
      }),
      this.prisma.authToken.create({
        data: {
          userId,
          kind,
          tokenHash: this.fingerprint(rawToken),
          expiresAt: new Date(Date.now() + TTL_MINUTES[kind] * 60_000)
        }
      })
    ]);

    return rawToken;
  }

  /**
   * Canjea un enlace y devuelve de quién era.
   *
   * El consumo va en un `updateMany` condicionado a `usedAt: null`, así que dos
   * peticiones simultáneas con el mismo enlace solo pueden gastarlo una vez.
   */
  async consume(rawToken: string, kind: AuthTokenKind): Promise<string> {
    const token = await this.prisma.authToken.findUnique({
      where: { tokenHash: this.fingerprint(rawToken) },
      select: { id: true, userId: true, kind: true, expiresAt: true, usedAt: true }
    });

    // El mismo mensaje para todos los motivos: quien prueba enlaces al azar no
    // debe poder distinguir uno caducado de uno que nunca existió.
    const invalid = new UnauthorizedException('El enlace no es válido o ya ha caducado');
    if (!token || token.kind !== kind || token.usedAt || token.expiresAt.getTime() <= Date.now()) throw invalid;

    const consumed = await this.prisma.authToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() }
    });
    if (consumed.count === 0) throw invalid;

    return token.userId;
  }
}
