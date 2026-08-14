import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';

import { Role } from '../../generated/prisma/enums';
import { SecurityConfig } from '../config/security.config';
import { PUBLIC_ROUTE, SERVICE_TOKEN_ALLOWED } from './auth.decorators';
import type { AccessTokenPayload } from './tokens.service';

const SERVICE_TOKEN_HEADER = 'x-pulse-admin-token';

/** `sub` de las peticiones que entran con el token de servicio, no con una cuenta. */
export const SERVICE_PRINCIPAL_ID = 'service:pulse-admin-token';

/** Quien hace la petición: una cuenta de usuario o un proceso automatizado. */
export interface Principal extends AccessTokenPayload {
  /** Cierto solo para el token de servicio, que no tiene fila en `User`. */
  isService?: boolean;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user?: Principal;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Autenticación global: sin `@Public()`, no se entra.
 *
 * Solo comprueba la firma y la caducidad del JWT, sin consultar la base de
 * datos, que es lo que permite ponerlo delante de todo sin pagar una consulta
 * por petición. El precio es que un cambio de rol tarda como mucho lo que le
 * quede de vida al access token.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: SecurityConfig
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (this.reflector.getAllAndOverride<boolean>(SERVICE_TOKEN_ALLOWED, targets) && this.hasServiceToken(request)) {
      request.user = { sub: SERVICE_PRINCIPAL_ID, role: Role.ADMIN, isService: true };
      return true;
    }

    const token = AuthenticationGuard.bearerToken(request);
    if (!token) throw new UnauthorizedException('Falta la cabecera Authorization');

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.accessSecret
      });
    } catch {
      // El motivo exacto —firma inválida, token caducado, formato roto— no se
      // devuelve: al cliente le sirve lo mismo y a quien sondea le sirve menos.
      throw new UnauthorizedException('Access token inválido o caducado');
    }

    return true;
  }

  /**
   * Comprueba el secreto compartido de los procesos automatizados.
   *
   * Falla en silencio si el servidor no lo tiene configurado: no es un error,
   * significa que esa vía está cerrada y la petición debe seguir hasta el JWT.
   * Hashear ambos lados le da a `timingSafeEqual` dos buffers del mismo tamaño
   * aunque el token recibido tenga otra longitud.
   */
  private hasServiceToken(request: FastifyRequest): boolean {
    const configured = process.env.PULSE_ADMIN_TOKEN;
    if (!configured) return false;

    const rawHeader = request.headers[SERVICE_TOKEN_HEADER];
    const supplied = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    return typeof supplied === 'string' && timingSafeEqual(digest(supplied), digest(configured));
  }

  private static bearerToken(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (typeof header !== 'string') return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
