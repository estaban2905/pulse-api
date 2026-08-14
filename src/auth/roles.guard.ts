import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Role } from '../../generated/prisma/enums';
import { REQUIRED_ROLES } from './auth.decorators';
import type { AuthenticatedRequest } from './authentication.guard';

/**
 * Autorización por rol. Corre después de la autenticación, así que aquí ya hay
 * un `request.user` de confianza.
 *
 * Sin `@Roles()` no opina: la mayoría de las rutas solo necesitan saber quién
 * llama, no de qué tipo es. Y responde 403 y no 401 a propósito —el credencial
 * era válido, lo que falta es permiso— para que el cliente no intente renovar
 * un token que no tiene nada de malo.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Tu cuenta no tiene permiso para esta operación');
    }

    return true;
  }
}
