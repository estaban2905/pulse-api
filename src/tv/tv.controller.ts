import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ApiErrorDto } from '../common/error.dto';
import { Public } from '../auth/auth.decorators';
import { CurrentUser } from '../auth/current-user.decorator';
import type { Principal } from '../auth/authentication.guard';
import { ClaimTvSessionDto, CreateTvSessionDto, ReportNowPlayingDto, TvCommandDto } from './tv.dto';
import { NowPlayingStateDto, TvCommandResultDto, TvPairingDto, TvScreenDto } from './tv.responses';
import { TvService } from './tv.service';

/** La cabecera con la que se identifica una pantalla ya emparejada. */
const TV_TOKEN_HEADER = 'x-pulse-tv-token';

/**
 * La pantalla del televisor.
 *
 * `@Public()` no significa abierto: significa que no se pide un Bearer, porque
 * un televisor no inicia sesión. Escribir una contraseña con un mando a
 * distancia es una forma de perder usuarios, así que la pantalla enseña un
 * código y el teléfono lo reclama. Después se identifica con su propio token,
 * que no vale para nada más que preguntar qué suena.
 */
@ApiTags('Televisores')
@Controller('tv')
@Public()
export class TvController {
  constructor(private readonly tv: TvService) {}

  @Post('sessions')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'createTvSession',
    summary: 'Abrir una pantalla y pedir código',
    description:
      'Lo llama el televisor al arrancar. Devuelve el código que hay que enseñar —dentro de un QR— y el token con el que la pantalla preguntará después. El código caduca a los dos minutos.'
  })
  @ApiCreatedResponse({ type: TvPairingDto })
  createSession(@Body() body: CreateTvSessionDto) {
    return this.tv.createSession(body.name);
  }

  @Get('now-playing')
  // La pantalla pregunta cada pocos segundos, así que el techo general de 120
  // se le queda corto: con dos televisores encendidos ya lo rozaría.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'pollTvSession',
    summary: 'Qué debe mostrar la pantalla',
    description:
      'Tres respuestas en una: que siga esperando a que la reclamen, que ya está emparejada pero sin música, o qué suena. También sirve de latido para saber que el televisor sigue encendido.'
  })
  @ApiHeader({ name: 'X-Pulse-Tv-Token', required: true, description: 'El token que devolvió el emparejamiento.' })
  @ApiOkResponse({ type: NowPlayingStateDto })
  @ApiUnauthorizedResponse({ description: 'La pantalla ya no está autorizada.', type: ApiErrorDto })
  poll(@Headers(TV_TOKEN_HEADER) token?: string) {
    if (!token) throw new BadRequestException('Falta la cabecera X-Pulse-Tv-Token');
    return this.tv.poll(token);
  }

  @Post('command')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'sendTvCommand',
    summary: 'El mando pide algo al teléfono',
    description:
      'El televisor no reproduce por su cuenta: quien manda sobre la cola y la reproducción es el teléfono. Esto es lo que hace que el botón de pausa del mando sirva para algo. Las órdenes caducan a los 20 segundos.'
  })
  @ApiHeader({ name: 'X-Pulse-Tv-Token', required: true })
  @ApiNoContentResponse({ description: 'Anotada.' })
  @HttpCode(204)
  async command(@Body() body: TvCommandDto, @Headers(TV_TOKEN_HEADER) token?: string): Promise<void> {
    if (!token) throw new BadRequestException('Falta la cabecera X-Pulse-Tv-Token');
    await this.tv.sendCommand(token, body.action, body.value);
  }
}

/**
 * El otro lado: el teléfono.
 *
 * Vive bajo `/me` porque todo lo de aquí es de la cuenta que llama, y el
 * identificador de usuario nunca viaja por parámetro.
 */
@ApiTags('Televisores')
@ApiBearerAuth('BearerAuth')
@ApiUnauthorizedResponse({ description: 'Falta el access token, o no es válido.', type: ApiErrorDto })
@Controller('me')
export class MeTvController {
  constructor(private readonly tv: TvService) {}

  @Post('tv/claim')
  @ApiOperation({
    operationId: 'claimTvSession',
    summary: 'Vincular un televisor',
    description: 'Con el código que enseña la pantalla. A partir de aquí, ese televisor sigue a esta cuenta.'
  })
  @ApiOkResponse({ type: TvScreenDto })
  @ApiNotFoundResponse({ description: 'El código no es válido o ya caducó.', type: ApiErrorDto })
  @HttpCode(200)
  claim(@CurrentUser() user: Principal, @Body() body: ClaimTvSessionDto) {
    return this.tv.claim(user.sub, body.code);
  }

  @Get('tv')
  @ApiOperation({
    operationId: 'listTvScreens',
    summary: 'Televisores vinculados',
    description: '`online` es cierto si la pantalla dio señales en el último minuto.'
  })
  @ApiOkResponse({ type: [TvScreenDto] })
  list(@CurrentUser() user: Principal) {
    return this.tv.listForUser(user.sub);
  }

  @Delete('tv/:sessionId')
  @ApiOperation({ operationId: 'unlinkTvScreen', summary: 'Desvincular un televisor' })
  @ApiNoContentResponse({ description: 'Desvinculado, o no estaba.' })
  @HttpCode(204)
  async unlink(@CurrentUser() user: Principal, @Param('sessionId') sessionId: string): Promise<void> {
    await this.tv.unlink(user.sub, sessionId);
  }

  @Get('tv/commands')
  // El teléfono pregunta cada dos segundos mientras hay un televisor encendido;
  // el techo general de 120 se le quedaría corto.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'takeTvCommands',
    summary: 'Recoger lo que pidió el mando',
    description:
      'Devuelve las órdenes pendientes y las borra en la misma operación: una pausa no se puede aplicar dos veces. Lo que lleve más de 20 segundos sin recogerse se descarta.'
  })
  @ApiOkResponse({ type: [TvCommandResultDto] })
  takeCommands(@CurrentUser() user: Principal) {
    return this.tv.takeCommands(user.sub);
  }

  @Put('now-playing')
  // Se informa al cambiar de canción y al pausar, no en cada segundo: la
  // pantalla extrapola la posición entre dos avisos.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'reportNowPlaying',
    summary: 'Informar de qué suena',
    description:
      'Lo llama el teléfono al empezar una canción, al pausar y al saltar. No hace falta en cada segundo: la respuesta lleva el momento del aviso para que la pantalla calcule el resto.'
  })
  @ApiNoContentResponse({ description: 'Registrado.' })
  @HttpCode(204)
  async report(@CurrentUser() user: Principal, @Body() body: ReportNowPlayingDto): Promise<void> {
    await this.tv.report(user.sub, body.trackId, body.positionMs, body.isPlaying);
  }
}
