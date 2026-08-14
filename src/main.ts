import 'reflect-metadata';
// Antes que nada: los proveedores se construyen al crear el módulo y ya
// necesitan DATABASE_URL leída del .env.
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

async function bootstrap() {
  // `trustProxy` no es cosmético: detrás del balanceador de Render, `req.ip` es
  // siempre la misma IP interna, así que el limitador trataría a todo el mundo
  // como un único cliente y los 5 intentos por minuto de los endpoints de
  // contraseña serían 5 para el servicio entero. Con esto Fastify lee
  // `X-Forwarded-For` y cada quien vuelve a tener su propio cupo.
  //
  // El `1` es el número de saltos de confianza, y va en lugar de `true` a
  // propósito: `true` se queda con el valor de más a la izquierda de la
  // cabecera, que lo escribe quien llama. Cualquiera podría entonces mandar un
  // `X-Forwarded-For` inventado y estrenar cupo en cada intento de login, que
  // es justo lo que el límite existe para impedir. Con `1` se cuenta desde el
  // socket hacia dentro y solo se cree al balanceador de Render, el único
  // salto que hay delante. Si algún día se pone un CDN por encima, serán 2.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, trustProxy: 1 })
  );
  await app.register(multipart, {
    limits: { fields: 5, files: 1, fileSize: 60 * 1024 * 1024 }
  });

  // El refresh token viaja en una cookie `httpOnly`, así que el servidor
  // necesita saber leerlas y ponerlas. Sin firma: el valor ya es un secreto
  // opaco de 32 bytes que se coteja contra la base de datos.
  await app.register(cookie);

  await app.register(helmet, {
    // La política por defecto es `same-origin`, que impediría a la web cargar
    // las portadas y el audio por estar en otro origen: rompería justo lo que
    // esta API existe para servir.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Una API que devuelve JSON y archivos no ejecuta HTML propio, salvo la
    // interfaz de Swagger, a la que una CSP estricta dejaría sin estilos.
    contentSecurityPolicy: false
  });

  app.setGlobalPrefix('v1');

  // Los DTO son el contrato: lo que no declaran, no entra. `forbidNonWhitelisted`
  // convierte un campo mal escrito en un 400 con el nombre del culpable, en vez
  // de en un cambio que se ignora en silencio.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  // Reflejar cualquier origen dejó de ser inocuo al aparecer la cookie de
  // sesión: con `credentials`, un origen reflejado es cualquier página web
  // haciendo peticiones autenticadas en nombre de quien la visite.
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && allowedOrigins.length === 0) {
    console.warn('CORS_ORIGINS está vacío: ningún navegador podrá llamar a este API.');
  }

  /**
   * Cualquier puerto del bucle local, solo fuera de producción.
   *
   * Vite ofrece la misma página en `localhost` y en `127.0.0.1`, y cambia de
   * puerto cuando el suyo está ocupado. Una lista fija convierte cada una de
   * esas variantes en un catálogo que no carga y sin más explicación que un
   * aviso en la consola del navegador.
   */
  const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

  app.enableCors({
    origin: (origin, callback) => {
      // Sin cabecera `Origin` no hay navegador detrás —curl, la app móvil— y
      // por tanto tampoco la clase de ataque que esta lista evita.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (!isProduction && LOOPBACK.test(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization', 'X-Pulse-Client', 'X-Pulse-Admin-Token'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length']
  });

  // Fuera del prefijo `/v1`: la documentación no es parte de la API versionada.
  SwaggerModule.setup('docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    yamlDocumentUrl: 'docs/openapi.yaml',
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    customSiteTitle: 'Pulse Music API'
  });

  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
