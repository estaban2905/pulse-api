import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

import { AuthTokenKind } from '../../generated/prisma/enums';
import { canonicalEmail } from '../common/email';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTokensService } from './auth-tokens.service';
import { MailService } from './mail.service';
import { TokensService, type SessionTokens } from './tokens.service';
import type { LoginDto, RegisterDto } from './auth.dto';
import type { UserProfileDto } from './auth.responses';

/**
 * Parámetros de argon2id recomendados por OWASP: 19 MiB de memoria, dos
 * pasadas, sin paralelismo. El coste en memoria es lo que quita la ventaja a
 * quien ataque con GPU.
 */
const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const;

/** Lo que se devuelve puertas afuera tras abrir sesión. */
export interface AuthResult {
  user: UserProfileDto;
  tokens: SessionTokens;
}

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: import('../../generated/prisma/enums').Role;
  createdAt: Date;
};

const PROFILE_FIELDS = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  createdAt: true
} as const;

@Injectable()
export class AuthService {
  /**
   * Hash contra el que se compara cuando el correo no existe.
   *
   * Sin él, un login fallido por correo desconocido responde mucho antes que
   * uno fallido por contraseña, y ese hueco de tiempo delata qué cuentas están
   * dadas de alta. Se calcula una vez y se reutiliza.
   */
  private readonly decoyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly authTokens: AuthTokensService,
    private readonly mail: MailService
  ) {
    this.decoyHash = argonHash(randomBytes(32).toString('hex'), ARGON_OPTIONS);
  }

  /** Base pública de la web, donde caen los enlaces que se envían por correo. */
  private get webUrl(): string {
    return (process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  }

  private static toProfile(user: UserRow): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt.toISOString()
    };
  }

  /**
   * Alta de una cuenta.
   *
   * El 409 distingue "ese correo ya está" de un fallo de validación. Sí permite
   * comprobar si una dirección está registrada, pero ocultarlo obligaría a
   * mentir en el formulario de registro, y quien quiera averiguarlo lo consigue
   * igual desde el flujo de recuperación de contraseña.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    // Se compara por la forma canónica, no por lo escrito: en Gmail los puntos
    // y las etiquetas `+algo` no crean buzones distintos, y sin esto la misma
    // bandeja podía acumular tantas cuentas como puntos le cupieran al nombre.
    const emailKey = canonicalEmail(dto.email);
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ emailKey }, { email: dto.email }] },
      select: { id: true }
    });
    if (existing) throw new ConflictException('Ya hay una cuenta con ese correo');

    const passwordHash = await argonHash(dto.password, ARGON_OPTIONS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        emailKey,
        passwordHash,
        displayName: dto.displayName || dto.email.split('@')[0],
        preferences: { create: {} }
      },
      select: PROFILE_FIELDS
    });

    return { user: AuthService.toProfile(user), tokens: await this.tokens.issueSession(user) };
  }

  /**
   * Login por correo y contraseña.
   *
   * El mensaje es el mismo en los tres motivos de fallo —correo desconocido,
   * cuenta sin contraseña, contraseña incorrecta— porque cualquier diferencia
   * convierte el formulario en un comprobador de cuentas ajenas.
   */
  async login(dto: LoginDto): Promise<AuthResult> {
    // También por la forma canónica: quien se registró sin puntos tiene que
    // poder entrar escribiéndolos, porque para su proveedor es el mismo correo.
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ emailKey: canonicalEmail(dto.email) }, { email: dto.email }] },
      select: { ...PROFILE_FIELDS, passwordHash: true }
    });

    const storedHash = user?.passwordHash ?? (await this.decoyHash);
    const passwordMatches = await argonVerify(storedHash, dto.password, ARGON_OPTIONS).catch(() => false);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const { passwordHash: _ignored, ...profile } = user;
    return { user: AuthService.toProfile(profile), tokens: await this.tokens.issueSession(profile) };
  }

  /** Canjea el refresh token y devuelve el perfil junto a la pareja nueva. */
  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const { tokens, user } = await this.tokens.rotate(rawRefreshToken);
    return { user: await this.currentUser(user.id), tokens };
  }

  /** Perfil del titular del access token. */
  async currentUser(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_FIELDS
    });
    if (!user) throw new NotFoundException('La cuenta ya no existe');
    return AuthService.toProfile(user);
  }

  // ---------------------------------------------------------------------
  // Recuperación de contraseña
  // ---------------------------------------------------------------------

  /**
   * Manda el enlace de restablecimiento, si esa cuenta existe.
   *
   * Nunca dice si el correo estaba dado de alta: responder distinto convertiría
   * el formulario en una lista de qué direcciones tienen cuenta. Por eso este
   * método no devuelve nada y el controlador responde siempre igual.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ emailKey: canonicalEmail(email) }, { email }] },
      select: { id: true, email: true, displayName: true }
    });
    if (!user) return;

    const token = await this.authTokens.issue(user.id, AuthTokenKind.PASSWORD_RESET);
    const link = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await this.mail.send({
      to: user.email,
      subject: 'Restablece tu contraseña de Pulse',
      body: [
        `Hola ${user.displayName}:`,
        '',
        'Alguien ha pedido restablecer la contraseña de tu cuenta. Si has sido tú, abre este enlace:',
        link,
        '',
        'Caduca en una hora y solo se puede usar una vez.',
        'Si no has sido tú, no hace falta que hagas nada: tu contraseña sigue igual.'
      ].join('\n')
    });
  }

  /**
   * Fija la contraseña nueva y cierra todas las sesiones.
   *
   * Lo segundo es la mitad del sentido de restablecer: si la contraseña se
   * cambia porque alguien más la tenía, dejar viva su sesión no arreglaría nada.
   */
  async resetPassword(rawToken: string, password: string): Promise<void> {
    const userId = await this.authTokens.consume(rawToken, AuthTokenKind.PASSWORD_RESET);
    const passwordHash = await argonHash(password, ARGON_OPTIONS);

    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
  }

  // ---------------------------------------------------------------------
  // Verificación del correo
  // ---------------------------------------------------------------------

  async requestEmailVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, emailVerifiedAt: true }
    });
    if (!user || user.emailVerifiedAt) return;

    const token = await this.authTokens.issue(user.id, AuthTokenKind.EMAIL_VERIFICATION);
    const link = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;

    await this.mail.send({
      to: user.email,
      subject: 'Confirma tu correo en Pulse',
      body: [
        `Hola ${user.displayName}:`,
        '',
        'Confirma que este buzón es tuyo abriendo este enlace:',
        link,
        '',
        'Caduca en 24 horas.'
      ].join('\n')
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.authTokens.consume(rawToken, AuthTokenKind.EMAIL_VERIFICATION);
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }
}
