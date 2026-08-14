import { Controller, ForbiddenException, Get, Headers, Param, Query, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { Public } from '../auth/auth.decorators';
import { CatalogService } from '../catalog/catalog.service';
import { MediaSigningService } from '../config/media-signing.service';

/**
 * Entrega del audio.
 *
 * `@Public()` no significa abierto: significa que no se pide un Bearer, porque
 * un `<audio src>` no puede mandar cabeceras. El permiso viaja firmado en la
 * propia URL, y sin firma válida esto no devuelve un byte.
 */
@ApiTags('Reproducción')
@Controller('tracks')
@Public()
export class TracksController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly mediaSigning: MediaSigningService
  ) {}

  @Get(':id/stream')
  @ApiOperation({
    operationId: 'streamTrack',
    summary: 'Reproducir una pista',
    description:
      'Devuelve el MP3 entero, o el trozo pedido si llega una cabecera `Range`. El reproductor necesita rangos para poder saltar por la canción sin descargarla completa.'
  })
  @ApiParam({
    name: 'id',
    description: 'UUID de la pista, su slug canónico, o un identificador antiguo `tr-*`.',
    example: 'get-lucky'
  })
  @ApiQuery({
    name: 'v',
    required: false,
    description:
      'Marca de versión que emite el catálogo. Solo rompe la caché del cliente cuando se reemplaza el audio; el servidor la ignora.'
  })
  @ApiQuery({ name: 'exp', required: true, description: 'Caducidad de la firma, en segundos desde la época.' })
  @ApiQuery({ name: 'sig', required: true, description: 'Firma que emite el catálogo junto a la URL.' })
  @ApiHeader({ name: 'Range', required: false, description: 'Por ejemplo `bytes=0-65535`.' })
  @ApiProduces('audio/mpeg')
  @ApiResponse({ status: 200, description: 'MP3 completo.' })
  @ApiResponse({ status: 206, description: 'Trozo del MP3 pedido por `Range`.' })
  @ApiForbiddenResponse({ description: 'La firma falta, no cuadra, o ya caducó. Vuelve a pedir `/catalog`.' })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.' })
  @ApiResponse({ status: 416, description: 'El `Range` pedido cae fuera del archivo.' })
  async stream(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() reply: FastifyReply
  ) {
    // Antes de tocar la base de datos ni el disco: una firma inválida no
    // merece ni una consulta, y comprobarlo aquí evita además confirmar si
    // la pista existe a quien no trae permiso.
    if (!this.mediaSigning.verify(id, exp, sig)) {
      throw new ForbiddenException('Enlace de audio inválido o caducado');
    }

    const track = await this.catalog.getTrack(id);
    const filePath = join(process.cwd(), 'storage', 'audio', track.storageKey);
    const size = statSync(filePath).size;
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=3600');

    if (!range) {
      return reply.header('Content-Length', size).send(createReadStream(filePath));
    }

    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    const end = Math.min(requestedEnd, size - 1);
    if (start >= size || start > end) return reply.code(416).header('Content-Range', `bytes */${size}`).send();

    return reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .send(createReadStream(filePath, { start, end }));
  }
}
