import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { Public } from '../auth/auth.decorators';
import { CatalogService } from './catalog.service';
import { CatalogDto } from './catalog.responses';

/**
 * `If-None-Match` puede traer varios ETags separados por comas, y `*` significa
 * «cualquiera que tengas». Compararlo entero contra el nuestro fallaría en
 * cuanto un intermediario añadiera el suyo.
 */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag);
}

// Sigue siendo público: la web muestra el catálogo antes de pedir cuenta, y
// "explorar sin cuenta" es una opción de la propia pantalla de acceso.
@ApiTags('Catálogo')
@Controller('catalog')
@Public()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({
    operationId: 'getCatalog',
    summary: 'Catálogo público completo',
    description:
      'Artistas, álbumes y pistas publicadas, con URLs ya absolutas. Solo aparece lo publicado: una pista incompleta queda fuera. La respuesta lleva `ETag`: reenviarlo en `If-None-Match` ahorra la descarga entera cuando el catálogo no ha cambiado.'
  })
  @ApiHeader({
    name: 'If-None-Match',
    required: false,
    description: 'ETag recibido en una respuesta anterior. Si sigue vigente, la respuesta es `304` y sin cuerpo.'
  })
  @ApiOkResponse({ type: CatalogDto })
  @ApiResponse({ status: 304, description: 'El catálogo no ha cambiado desde el ETag enviado.' })
  async getCatalog(
    @Headers('host') host = 'localhost:4000',
    @Headers('x-forwarded-proto') protocol = 'http',
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() reply: FastifyReply
  ) {
    const { body, etag } = await this.catalog.getSnapshot(`${protocol}://${host}/v1`);

    // `must-revalidate` en lugar de un `max-age` largo: el catálogo cambia
    // cuando un administrador publica, no en un horario previsible, así que se
    // prefiere una pregunta barata —que casi siempre acaba en 304— a servir
    // durante minutos un catálogo al que le falta la última canción.
    reply.header('ETag', etag).header('Cache-Control', 'public, max-age=30, must-revalidate');

    if (matchesEtag(ifNoneMatch, etag)) return reply.code(304).send();

    // El cuerpo ya viene serializado, así que se manda tal cual en vez de
    // dejar que Fastify vuelva a convertir a JSON lo que ya es JSON.
    return reply.code(200).type('application/json; charset=utf-8').send(body);
  }
}
