import { Controller, Get, Headers } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CatalogService } from './catalog.service';
import { CatalogDto } from './catalog.responses';

@ApiTags('Catálogo')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({
    operationId: 'getCatalog',
    summary: 'Catálogo público completo',
    description:
      'Artistas, álbumes y pistas publicadas, con URLs ya absolutas. Solo aparece lo publicado: una pista incompleta queda fuera.'
  })
  @ApiOkResponse({ type: CatalogDto })
  getCatalog(@Headers('host') host = 'localhost:4000', @Headers('x-forwarded-proto') protocol = 'http') {
    return this.catalog.getCatalog(`${protocol}://${host}/v1`);
  }
}