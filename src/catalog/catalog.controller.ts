import { Controller, Get, Headers } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/auth.decorators';
import { CatalogService } from './catalog.service';
import { CatalogDto } from './catalog.responses';

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
      'Artistas, álbumes y pistas publicadas, con URLs ya absolutas. Solo aparece lo publicado: una pista incompleta queda fuera.'
  })
  @ApiOkResponse({ type: CatalogDto })
  getCatalog(@Headers('host') host = 'localhost:4000', @Headers('x-forwarded-proto') protocol = 'http') {
    return this.catalog.getCatalog(`${protocol}://${host}/v1`);
  }
}