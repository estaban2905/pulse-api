import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const contentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

@ApiTags('Media')
@Controller('media')
export class MediaController {
  @Get('covers/:file')
  @ApiOperation({
    operationId: 'getCover',
    summary: 'Servir una portada',
    description:
      'Los archivos se nombran por el hash de su contenido, así que son inmutables y pueden cachearse un día entero.'
  })
  @ApiParam({
    name: 'file',
    description: 'Nombre del archivo devuelto al subir la portada.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.jpg'
  })
  @ApiResponse({ status: 200, description: 'La imagen (JPEG, PNG o WebP).' })
  @ApiNotFoundResponse({ description: 'No hay ninguna portada con ese nombre.' })
  cover(@Param('file') file: string, @Res() reply: FastifyReply) {
    const safeName = basename(file);
    const filePath = join(process.cwd(), 'storage', 'covers', safeName);
    if (!existsSync(filePath)) throw new NotFoundException('Artwork not found');
    return reply
      .header('Content-Type', contentTypes[extname(safeName).toLowerCase()] ?? 'application/octet-stream')
      .header('Cache-Control', 'public, max-age=86400')
      .send(createReadStream(filePath));
  }
}
