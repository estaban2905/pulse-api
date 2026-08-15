import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../auth/auth.decorators';
import { LyricsService } from './lyrics.service';
import { LyricsDto } from './lyrics.responses';

/**
 * Letras de las pistas.
 *
 * Público, como el catálogo: la letra se puede abrir sin cuenta, igual que se
 * puede escuchar la canción.
 *
 * El tope propio es más bajo que el general porque una petición que no está
 * cacheada sale a un servicio ajeno y gratuito. Quien pase de aquí estaría
 * gastando la cuota de LRCLIB, no la nuestra.
 */
@ApiTags('Letras')
@Controller('tracks')
@Public()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class LyricsController {
  constructor(private readonly lyrics: LyricsService) {}

  @Get(':identifier/lyrics')
  @ApiOperation({
    operationId: 'getTrackLyrics',
    summary: 'Letra de una pista',
    description:
      'Devuelve la letra ya guardada o, la primera vez, la pide al proveedor y la conserva. Que una canción no tenga letra no es un error: se responde `200` con `status: "missing"` y `lines` vacío, y esa respuesta también se guarda para no repetir la consulta.'
  })
  @ApiParam({
    name: 'identifier',
    description: 'UUID de la pista, su slug canónico, o un identificador antiguo `tr-*`.',
    example: 'get-lucky'
  })
  @ApiOkResponse({ type: LyricsDto })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.' })
  @ApiServiceUnavailableResponse({
    description: 'El proveedor no respondió y no había ninguna letra guardada para esta pista.'
  })
  getLyrics(@Param('identifier') identifier: string) {
    return this.lyrics.getForTrack(identifier);
  }
}
