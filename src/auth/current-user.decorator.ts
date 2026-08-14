import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, Principal } from './authentication.guard';

/**
 * Inyecta el titular del access token en un método de controlador.
 *
 * Solo tiene valor detrás de un guard que autentique; en una ruta pública
 * llega `undefined`, que es justo lo que debe pasar.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user
);
