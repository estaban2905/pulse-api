import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';

import { Role } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityConfig } from '../config/security.config';

/** Bytes de entropía de un refresh token antes de codificarlo. */
const REFRESH_TOKEN_BYTES = 32;

export interface AccessTokenPayload {
  /** UUID del usuario. */
  sub: string;
  role: Role;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos que le quedan al access token, para que el cliente se adelante. */
  expiresIn: number;
}

export interface SessionUser {
  id: string;
  role: Role;
}

/** Resultado de un canje: los tokens nuevos y de quién son. */
export interface RotatedSession {
  tokens: SessionTokens;
  user: SessionUser;
}

/**
 * Emisión y rotación de la pareja access/refresh.
 *
 * El access token es un JWT: se verifica con la firma, sin tocar la base de
 * datos, que es lo que permite protegerlo todo sin una consulta por petición.
 * El refresh token es lo contrario —un valor opaco, guardado y revocable— y por
 * eso es el único que puede durar semanas.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: SecurityConfig
  ) {}

  /**
   * Huella con la que viaja el refresh token a la base de datos.
   *
   * Es un HMAC y no un hash a secas: así la tabla por sí sola no basta para
   * reconstruir un token válido, y rotar `JWT_REFRESH_SECRET` cierra todas las
   * sesiones abiertas de golpe sin tener que borrar nada.
   */
  private fingerprint(rawToken: string): string {
    return createHmac('sha256', this.config.refreshSecret).update(rawToken, 'utf8').digest('hex');
  }

  private async signAccessToken(user: SessionUser): Promise<string> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    return this.jwt.signAsync(payload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessTtl
    });
  }

  /** Abre una sesión nueva: tras un registro o un login correcto. */
  async issueSession(user: SessionUser): Promise<SessionTokens> {
    const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.fingerprint(rawRefreshToken),
        expiresAt: this.config.refreshExpiryFrom(new Date())
      }
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: rawRefreshToken,
      expiresIn: this.accessTtlSeconds()
    };
  }

  /**
   * Canjea un refresh token por una pareja nueva y anula el anterior.
   *
   * Que un token ya usado vuelva a aparecer solo tiene dos explicaciones: se ha
   * copiado, o el cliente pidió dos refrescos a la vez. Ninguna se puede
   * distinguir de la otra desde aquí, así que se trata como robo y se cierran
   * todas las sesiones del usuario; el cliente evita la carrera encolando sus
   * propios refrescos.
   */
  async rotate(rawToken: string): Promise<RotatedSession> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.fingerprint(rawToken) },
      include: { user: { select: { id: true, role: true } } }
    });

    if (!existing) throw new UnauthorizedException('Refresh token inválido');

    if (existing.revokedAt) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Sesión revocada: el token ya se había usado');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token caducado');
    }

    // La condición `revokedAt: null` es la que hace atómico el canje: si dos
    // peticiones llegan a la vez, solo una actualiza una fila y la otra ve un
    // recuento de cero.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    if (claimed.count === 0) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Sesión revocada: el token ya se había usado');
    }

    return { tokens: await this.issueSession(existing.user), user: existing.user };
  }

  /** Cierra una sesión concreta. Es idempotente: repetirlo no es un error. */
  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.fingerprint(rawToken), revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  /** Cierra todas las sesiones del usuario, en todos sus dispositivos. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }

  /** El TTL configurado, en segundos, para anunciarlo en la respuesta. */
  private accessTtlSeconds(): number {
    const match = /^(\d+)([smhd])$/.exec(this.config.accessTtl);
    if (!match) return 900;
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(match[1]) * multipliers[match[2]];
  }
}
