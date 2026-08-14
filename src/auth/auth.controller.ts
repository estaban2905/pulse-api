import { Body, Controller, Get, Headers, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
// Trae la ampliación de tipos del plugin: `request.cookies`, `reply.setCookie`
// y `reply.clearCookie` los añade `@fastify/cookie` sobre las interfaces de
// Fastify, y sin esta importación TypeScript no los ve aquí.
import type {} from '@fastify/cookie';

import { ApiErrorDto } from '../common/error.dto';
import { SecurityConfig } from '../config/security.config';
import { AuthService, type AuthResult } from './auth.service';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto, VerifyEmailDto } from './auth.dto';
import { SessionDto, UserProfileDto } from './auth.responses';
import { CurrentUser } from './current-user.decorator';
import { Public } from './auth.decorators';
import type { Principal } from './authentication.guard';
import { TokensService } from './tokens.service';

/** Nombre de la cookie que lleva el refresh token en el navegador. */
const REFRESH_COOKIE = 'pulse_refresh';

/**
 * Ámbito de la cookie: solo los endpoints de sesión.
 *
 * Acotarlo al máximo significa que el credencial de larga vida no acompaña a
 * ninguna otra petición —ni al streaming, ni al catálogo—, así que no hay dónde
 * filtrarlo por accidente.
 */
const REFRESH_COOKIE_PATH = '/v1/auth';

/** Clientes que declaran no tener cookies y reciben el refresh en el cuerpo. */
const NATIVE_CLIENT = 'native';

/**
 * Freno para los endpoints que comparan contraseñas.
 *
 * Cinco intentos por minuto no molestan a nadie que se equivoque al teclear, y
 * convierten en inviable probar una lista de contraseñas: argon2 ya hace cara
 * cada prueba, esto limita además cuántas se pueden pedir.
 */
const PASSWORD_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Sesión')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly config: SecurityConfig
  ) {}

  @Post('register')
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @ApiOperation({
    operationId: 'register',
    summary: 'Crear una cuenta',
    description: 'Deja la sesión abierta: devuelve el access token y planta la cookie de refresco.'
  })
  @ApiHeader({ name: 'X-Pulse-Client', required: false, description: '`native` para recibir el refresh token en el cuerpo.' })
  @ApiCreatedResponse({ type: SessionDto })
  @ApiConflictResponse({ description: 'Ya hay una cuenta con ese correo.', type: ApiErrorDto })
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('x-pulse-client') client?: string
  ): Promise<SessionDto> {
    return this.respondWithSession(await this.auth.register(body), reply, client);
  }

  @Post('login')
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @HttpCode(200)
  @ApiOperation({ operationId: 'login', summary: 'Iniciar sesión' })
  @ApiHeader({ name: 'X-Pulse-Client', required: false, description: '`native` para recibir el refresh token en el cuerpo.' })
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'Correo o contraseña incorrectos.', type: ApiErrorDto })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers('x-pulse-client') client?: string
  ): Promise<SessionDto> {
    return this.respondWithSession(await this.auth.login(body), reply, client);
  }

  /**
   * Pública porque el access token caducado es justo el motivo de la llamada:
   * exigir uno válido para renovarlo haría el endpoint inútil. El credencial
   * que sí comprueba es el refresh token.
   */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'refresh',
    summary: 'Renovar el access token',
    description:
      'Rota el refresh token: el anterior queda anulado en el mismo canje. Si uno ya usado vuelve a aparecer se cierran todas las sesiones de esa cuenta, porque solo se copia lo que se ha robado.'
  })
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'Refresh token ausente, caducado o ya usado.', type: ApiErrorDto })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: RefreshDto,
    @Headers('x-pulse-client') client?: string
  ): Promise<SessionDto> {
    const token = this.readRefreshToken(request, body);
    if (!token) throw new UnauthorizedException('Falta el refresh token');
    return this.respondWithSession(await this.auth.refresh(token), reply, client);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'logout',
    summary: 'Cerrar la sesión actual',
    description: 'Anula el refresh token y borra la cookie. Es idempotente: sin sesión abierta también responde 204.'
  })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: RefreshDto
  ): Promise<void> {
    const token = this.readRefreshToken(request, body);
    if (token) await this.tokens.revoke(token);

    // La cookie se borra aunque no hubiera token válido: dejarla puesta obliga
    // al navegador a reintentar con un credencial que ya no sirve.
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, domain: this.config.cookieDomain });
  }

  @Post('forgot-password')
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @HttpCode(204)
  @ApiOperation({
    operationId: 'forgotPassword',
    summary: 'Pedir un enlace para restablecer la contraseña',
    description:
      'Responde 204 exista o no la cuenta. Decir cuál de las dos convertiría este formulario en una forma de averiguar qué correos están registrados.'
  })
  @ApiNoContentResponse({ description: 'Si esa cuenta existe, el enlace va de camino.' })
  async forgotPassword(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @Public()
  @Throttle(PASSWORD_THROTTLE)
  @HttpCode(204)
  @ApiOperation({
    operationId: 'resetPassword',
    summary: 'Fijar una contraseña nueva con el enlace recibido',
    description: 'Cierra todas las sesiones abiertas de esa cuenta: si la contraseña la tenía alguien más, su sesión también cae.'
  })
  @ApiNoContentResponse({ description: 'Contraseña cambiada. Hay que volver a iniciar sesión.' })
  @ApiUnauthorizedResponse({ description: 'El enlace no es válido, ya se usó o caducó.', type: ApiErrorDto })
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('verify-email/request')
  @HttpCode(204)
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({ operationId: 'requestEmailVerification', summary: 'Pedir el correo de confirmación' })
  @ApiNoContentResponse({ description: 'Enviado, o innecesario porque ya estaba verificado.' })
  async requestEmailVerification(@CurrentUser() user: Principal): Promise<void> {
    await this.auth.requestEmailVerification(user.sub);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(204)
  @ApiOperation({ operationId: 'verifyEmail', summary: 'Confirmar el correo con el enlace recibido' })
  @ApiNoContentResponse({ description: 'Correo confirmado.' })
  @ApiUnauthorizedResponse({ description: 'El enlace no es válido, ya se usó o caducó.', type: ApiErrorDto })
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  /** La única ruta de este controlador que exige sesión: las demás la crean. */
  @Get('me')
  @ApiBearerAuth('BearerAuth')
  @ApiOperation({ operationId: 'getMe', summary: 'Perfil de la sesión actual' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ description: 'Falta el access token, o no es válido.', type: ApiErrorDto })
  me(@CurrentUser() user: Principal): Promise<UserProfileDto> {
    return this.auth.currentUser(user.sub);
  }

  /** El refresh token llega por cookie en el navegador y por cuerpo en la app. */
  private readRefreshToken(request: FastifyRequest, body: RefreshDto | undefined): string | null {
    return request.cookies?.[REFRESH_COOKIE] ?? body?.refreshToken ?? null;
  }

  /**
   * Forma la respuesta y decide por dónde sale el refresh token.
   *
   * En el navegador va en una cookie `httpOnly` y nunca en el cuerpo: si
   * JavaScript pudiera leerlo, la vida larga del refresh convertiría cualquier
   * script inyectado en una sesión permanente.
   */
  private respondWithSession(result: AuthResult, reply: FastifyReply, client?: string): SessionDto {
    const { tokens, user } = result;
    const isNative = client?.toLowerCase() === NATIVE_CLIENT;

    if (isNative) {
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user, refreshToken: tokens.refreshToken };
    }

    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: this.config.cookieSameSite,
      path: REFRESH_COOKIE_PATH,
      domain: this.config.cookieDomain,
      maxAge: this.config.refreshTtlDays * 24 * 60 * 60
    });

    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user };
  }
}
