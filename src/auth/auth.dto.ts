import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

import { Optional, Trim } from '../common/validation';

/**
 * Mínimo de una contraseña.
 *
 * Diez y no ocho: la única defensa real contra el descifrado por fuerza bruta
 * fuera de línea es la longitud, y el coste de argon2 ya cubre el resto.
 */
const PASSWORD_MIN = 10;

/**
 * Tope de longitud. Argon2 no tiene el límite de 72 bytes de bcrypt, pero
 * hashear una entrada arbitrariamente larga sí es trabajo que se puede pedir
 * sin autenticarse.
 */
const PASSWORD_MAX = 128;

/** Normaliza el correo: es la clave única, y `A@x.com` y `a@x.com` son el mismo buzón. */
const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class RegisterDto {
  @ApiProperty({ example: 'ana@ejemplo.com', description: 'Se guarda en minúsculas.' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'una-contraseña-larga',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    description: 'Nunca se almacena: solo su hash argon2id.'
  })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password!: string;

  @ApiPropertyOptional({
    example: 'Ana',
    description: 'Si falta, se usa la parte del correo anterior a la arroba.'
  })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 60)
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@ejemplo.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'una-contraseña-larga' })
  @IsString()
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ana@ejemplo.com' })
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'El token que viaja en el enlace del correo.' })
  @IsString()
  @Length(16, 512)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsString()
  @Length(PASSWORD_MIN, PASSWORD_MAX)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'El token que viaja en el enlace del correo.' })
  @IsString()
  @Length(16, 512)
  token!: string;
}

/**
 * Cuerpo de refresco para clientes sin cookies.
 *
 * La web no lo usa —su refresh viaja en una cookie `httpOnly`, que el navegador
 * manda solo y JavaScript no puede leer—, pero la app móvil no tiene cookies y
 * guarda el token en el almacén seguro del sistema.
 */
export class RefreshDto {
  @ApiPropertyOptional({
    description: 'Solo para clientes nativos. En el navegador se ignora: manda la cookie.'
  })
  @Optional()
  @IsString()
  @Length(16, 512)
  refreshToken?: string;
}
