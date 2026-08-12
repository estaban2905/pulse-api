import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

export const OPENAPI_VERSION = '0.1.0';

/**
 * El documento OpenAPI, construido a partir de los decoradores del código.
 *
 * Vive aparte de `main.ts` porque lo usan dos: el servidor, que lo sirve en
 * `/docs`, y el script que escribe `openapi/pulse-api.yaml`. Si cada uno
 * construyera el suyo, el archivo del repositorio podría describir una API que
 * no es la que arranca —que es justo el problema que este archivo elimina.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Pulse Music API')
    .setDescription(
      [
        'Catálogo y reproducción de la biblioteca de Pulse.',
        '',
        'Lo público —`/health`, `/catalog`, `/tracks/{id}/stream`, `/media/covers/{file}`— no pide',
        'credenciales. Lo que hay bajo `/admin` mantiene el catálogo y va firmado con la cabecera',
        '`X-Pulse-Admin-Token`; si el servidor no tiene `PULSE_ADMIN_TOKEN` configurado, esa mitad',
        'responde 503 y queda cerrada.',
        '',
        'Toda ruta cuelga del prefijo `/v1`, ya incluido en la URL del servidor.'
      ].join('\n')
    )
    .setVersion(OPENAPI_VERSION)
    .addServer(process.env.PUBLIC_API_URL || 'http://localhost:4000/v1', 'Servidor')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Pulse-Admin-Token',
        description: 'Secreto compartido con quien mantiene el catálogo. Igual a `PULSE_ADMIN_TOKEN` en el servidor.'
      },
      'AdminToken'
    )
    .addTag('Health', 'Señal de vida del proceso')
    .addTag('Catálogo', 'Lo que consumen la web y la app')
    .addTag('Reproducción', 'Entrega del audio, con soporte de rangos')
    .addTag('Media', 'Portadas')
    .addTag('Admin', 'Mantenimiento del catálogo')
    .build();

  // El prefijo `/v1` ya está en la URL del servidor: incluirlo también en cada
  // ruta lo duplicaría al probar desde la propia interfaz de Swagger.
  return SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true });
}
