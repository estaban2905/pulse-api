import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import {
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
import { CatalogService } from '../catalog/catalog.service';

@ApiTags('Reproducción')
@Controller('tracks')
export class TracksController {
  constructor(private readonly catalog: CatalogService) {}

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
  @ApiHeader({ name: 'Range', required: false, description: 'Por ejemplo `bytes=0-65535`.' })
  @ApiProduces('audio/mpeg')
  @ApiResponse({ status: 200, description: 'MP3 completo.' })
  @ApiResponse({ status: 206, description: 'Trozo del MP3 pedido por `Range`.' })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.' })
  @ApiResponse({ status: 416, description: 'El `Range` pedido cae fuera del archivo.' })
  async stream(@Param('id') id: string, @Headers('range') range: string | undefined, @Res() reply: FastifyReply) {
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
