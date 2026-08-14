import { ApiProperty } from '@nestjs/swagger';

import { Role } from '../../generated/prisma/enums';

/** Esquemas que devuelve el API de sesión. */

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'ana@ejemplo.com' })
  email!: string;

  @ApiProperty({ example: 'Ana' })
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;

  @ApiProperty({ enum: Role, enumName: 'Role' })
  role!: Role;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/**
 * Respuesta de registro, login y refresco.
 *
 * El access token va en el cuerpo a propósito: el cliente lo guarda en memoria,
 * donde no sobrevive a una recarga ni lo alcanza un script inyectado que sí
 * leería `localStorage`. El refresh, en cambio, sale por `Set-Cookie` y no
 * aparece aquí salvo que el cliente declare no tener cookies.
 */
export class SessionDto {
  @ApiProperty({ description: 'JWT de acceso. Va en la cabecera `Authorization: Bearer`.' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Segundos de vida que le quedan al access token.' })
  expiresIn!: number;

  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;

  @ApiProperty({
    required: false,
    description:
      'Solo para clientes nativos, que lo piden con la cabecera `X-Pulse-Client: native`. En el navegador este campo no viene: el refresh viaja en una cookie `httpOnly`.'
  })
  refreshToken?: string;
}
