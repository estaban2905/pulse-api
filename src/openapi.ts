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
        'La autenticación es global: salvo lo marcado como público —`/health`, `/catalog`,',
        '`/tracks/{id}/stream`, `/media/covers/{file}` y el propio `/auth`—, toda ruta exige sesión.',
        '',
        '`/tracks/{id}/stream` es público en el sentido de que no pide un Bearer: un `<audio src>` no',
        'puede mandar cabeceras. En su lugar exige la firma que emite `/catalog` en cada `streamUrl`,',
        'válida 24 horas. Sin ella responde 403, y la forma de conseguir una nueva es volver a pedir',
        'el catálogo.',
        '',
        'Lo que hay bajo `/admin` mantiene el catálogo y pide rol `ADMIN`. Se entra de dos maneras:',
        'con la sesión de una cuenta administradora, o con la cabecera `X-Pulse-Admin-Token`, que',
        'queda reservada a los procesos automatizados. Un credencial válido pero sin rol recibe 403,',
        'no 401: no hay nada que renovar.',
        '',
        'Lo que hay bajo `/auth` abre y renueva sesiones. El access token es un JWT de vida corta que',
        'viaja en `Authorization: Bearer`; el refresh token dura semanas y sale en una cookie',
        '`httpOnly` que solo se manda a `/v1/auth`. Un cliente sin cookies —la app móvil— lo pide en',
        'el cuerpo con la cabecera `X-Pulse-Client: native`.',
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
        description:
          'Credencial de servicio para procesos sin persona detrás, igual a `PULSE_ADMIN_TOKEN` en el servidor. No es para el navegador: desde la web se entra con una cuenta de rol ADMIN.'
      },
      'AdminToken'
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token devuelto por `/auth/login`. Caduca a los 15 minutos: renuévalo en `/auth/refresh`.'
      },
      'BearerAuth'
    )
    .addTag('Health', 'Señal de vida del proceso')
    .addTag('Sesión', 'Registro, login y renovación de tokens')
    .addTag('Catálogo', 'Lo que consumen la web y la app')
    .addTag('Biblioteca', 'Favoritos, playlists e historial de cada cuenta')
    .addTag('Reproducción', 'Entrega del audio, con soporte de rangos')
    .addTag('Media', 'Portadas')
    .addTag('Admin', 'Mantenimiento del catálogo')
    .build();

  // El prefijo `/v1` ya está en la URL del servidor: incluirlo también en cada
  // ruta lo duplicaría al probar desde la propia interfaz de Swagger.
  return SwaggerModule.createDocument(app, config, { ignoreGlobalPrefix: true });
}
