import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';

import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi';

/**
 * Escribe `openapi/pulse-api.yaml` a partir de los decoradores del código.
 *
 * El archivo dejó de mantenerse a mano: se generaba solo la mitad de lo que la
 * API ofrecía de verdad, porque nada obligaba a actualizarlo al añadir una
 * ruta. Con `--check` el script no escribe nada y falla si el archivo del
 * repositorio no coincide con el código, que es la comprobación que hay que
 * poner en integración continua.
 */

const OUTPUT = join(process.cwd(), 'openapi', 'pulse-api.yaml');

async function main(): Promise<void> {
  // Generar el documento solo instancia los proveedores; nunca se conecta a la
  // base ni firma nada. La cadena de conexión y los secretos igualmente tienen
  // que existir porque `PrismaService` y `SecurityConfig` los exigen al
  // construirse, así que se ponen de mentira para que el script funcione donde
  // no hay `.env` —una CI, por ejemplo—.
  process.env.DATABASE_URL ??= 'postgresql://openapi:openapi@localhost:5432/openapi';
  process.env.JWT_ACCESS_SECRET ??= 'openapi-placeholder-access-secret-000000';
  process.env.JWT_REFRESH_SECRET ??= 'openapi-placeholder-refresh-secret-00000';
  process.env.MEDIA_SIGNING_SECRET ??= 'openapi-placeholder-media-secret-0000000';

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false
  });
  const document = buildOpenApiDocument(app);
  await app.close();

  const yaml = stringify(document, { lineWidth: 0 });

  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => '');
    if (current !== yaml) {
      console.error(
        'openapi/pulse-api.yaml está desincronizado con el código.\nEjecuta `npm run openapi` y añade el resultado al commit.'
      );
      process.exitCode = 1;
      return;
    }
    console.log('openapi/pulse-api.yaml coincide con el código.');
    return;
  }

  await writeFile(OUTPUT, yaml, 'utf8');
  console.log(`Escrito ${OUTPUT} (${Object.keys(document.paths ?? {}).length} rutas).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
