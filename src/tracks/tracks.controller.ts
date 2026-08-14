import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/auth.decorators';
import { CatalogService } from '../catalog/catalog.service';
import { MediaSigningService } from '../config/media-signing.service';
import { StorageService } from '../storage/storage.service';

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
    private readonly mediaSigning: MediaSigningService,
    private readonly storage: StorageService
  ) {}

  @Get(':id/stream')
  @ApiOperation({
    operationId: 'streamTrack',
    summary: 'Reproducir una pista',
    description:
      'Redirige al archivo en el almacenamiento de objetos, con un enlace temporal. El audio no pasa por este servidor: quien atiende la descarga —y las cabeceras `Range` que el reproductor necesita para saltar por la canción— es el almacenamiento.'
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
  @ApiResponse({ status: 302, description: 'Redirección al archivo, con un enlace firmado y temporal.' })
  @ApiForbiddenResponse({ description: 'La firma falta, no cuadra, o ya caducó. Vuelve a pedir `/catalog`.' })
  @ApiNotFoundResponse({ description: 'No existe ninguna pista con ese identificador.' })
  async stream(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() reply: FastifyReply
  ) {
    // Antes de tocar la base de datos: una firma inválida no merece ni una
    // consulta, y comprobarlo aquí evita además confirmar si la pista existe a
    // quien no trae permiso.
    if (!this.mediaSigning.verify(id, exp, sig)) {
      throw new ForbiddenException('Enlace de audio inválido o caducado');
    }

    const track = await this.catalog.getTrack(id);
    const url = await this.storage.signedAudioUrl(track.storageKey);

    // 302 y no 301: el destino lleva una firma que caduca, así que no se puede
    // dejar que ningún intermediario lo recuerde como permanente.
    //
    // Sin `Cache-Control` propio: el enlace es estable dentro de su ventana,
    // pero quien decide cuánto vive el audio ya descargado es la respuesta del
    // almacenamiento, no esta redirección.
    return reply.code(302).header('Location', url).send();
  }
}
