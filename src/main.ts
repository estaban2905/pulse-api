import 'reflect-metadata';
// Antes que nada: los proveedores se construyen al crear el módulo y ya
// necesitan DATABASE_URL leída del .env.
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  await app.register(multipart, {
    limits: { fields: 5, files: 1, fileSize: 60 * 1024 * 1024 }
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

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'X-Pulse-Admin-Token'],
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
