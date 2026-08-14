import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { basename } from 'node:path';

import { Public } from '../auth/auth.decorators';
import { StorageService } from '../storage/storage.service';

// Las portadas quedan públicas: son la carátula que ya se ve en el catálogo, y
// una imagen tras un token no se puede poner en un `<img src>` sin trabajo
// extra que aquí no compra nada.
@ApiTags('Media')
@Controller('media')
@Public()
export class MediaController {
  constructor(private readonly storage: StorageService) {}

  @Get('covers/:file')
  @ApiOperation({
    operationId: 'getCover',
    summary: 'Servir una portada',
    description:
      'Redirige a la portada en el almacenamiento de objetos. El catálogo ya devuelve esa dirección directamente, así que esta ruta existe sobre todo para los clientes que guardaron la antigua.'
  })
  @ApiParam({
    name: 'file',
    description: 'Nombre del archivo devuelto al subir la portada.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.jpg'
  })
  @ApiResponse({ status: 301, description: 'Redirección permanente a la imagen.' })
  cover(@Param('file') file: string, @Res() reply: FastifyReply) {
    // `basename` recorta cualquier intento de salirse del directorio. Ya no hay
    // sistema de archivos detrás, pero sí un nombre que acaba dentro de una URL.
    const safeName = basename(file);

    // 301 y no 302: los archivos se nombran por el hash de su contenido, así que
    // esta correspondencia no va a cambiar nunca y conviene que los clientes
    // dejen de preguntar.
    return reply.code(301).header('Location', this.storage.coverUrl(safeName)).send();
  }
}
