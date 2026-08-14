import { SetMetadata } from '@nestjs/common';

import type { Role } from '../../generated/prisma/enums';

export const PUBLIC_ROUTE = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';
export const SERVICE_TOKEN_ALLOWED = 'auth:serviceToken';

/**
 * Abre una ruta a quien no ha iniciado sesión.
 *
 * Hace falta decirlo explícitamente porque la autenticación es global: desde la
 * fase 2 una ruta nueva nace protegida y hay que abrirla a mano. Antes era al
 * revés, y bastaba con olvidarse de un guard para publicar un endpoint entero.
 */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Exige que el titular del token tenga uno de estos roles. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/**
 * Permite además la entrada con el token de servicio `PULSE_ADMIN_TOKEN`.
 *
 * Es la vía de los procesos sin persona detrás —`pulse-dl` publicando pistas,
 * una tarea de integración continua—, que no pueden pasar por un formulario de
 * login. Solo vale donde se declara: en el resto del API ese token no abre nada.
 */
export const AllowServiceToken = () => SetMetadata(SERVICE_TOKEN_ALLOWED, true);
