import 'dotenv/config';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/**
 * Sube `storage/` al almacenamiento de objetos.
 *
 * Existe porque publicar cada pista por el API reenviaría el MP3 entero y
 * recalcularía su hash: copiar los archivos tal cual preserva los `storageKey`
 * que la base ya tiene y no toca ni una fila.
 *
 * Es repetible. Antes de subir cada archivo pregunta si ya está con el mismo
 * tamaño, así que una ejecución interrumpida se reanuda relanzándola y no
 * vuelve a pagar la subida de lo que llegó.
 *
 * Uso:  npm run upload-storage
 *       npm run upload-storage -- --dry-run
 */

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

/**
 * Cuántas peticiones se mandan a la vez.
 *
 * En serie, mil trescientas comprobaciones son mil trescientas idas y vueltas
 * al otro lado del continente: minutos enteros antes de subir el primer byte.
 * De diez en diez la latencia se solapa y deja de ser lo que manda.
 */
const CONCURRENCY = 10;

/** Recorre la lista con `CONCURRENCY` tareas vivas, sin acumularlas todas. */
async function inParallel<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

function readVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta ${name} en el .env.`);
    process.exit(1);
  }
  return value;
}

interface Pending {
  path: string;
  key: string;
  bucket: string;
  size: number;
  contentType: string;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const client = new S3Client({
    endpoint: readVar('S3_ENDPOINT'),
    region: 'auto',
    credentials: {
      accessKeyId: readVar('S3_ACCESS_KEY'),
      secretAccessKey: readVar('S3_SECRET_KEY')
    },
    forcePathStyle: true
  });

  const directories = [
    { dir: join(process.cwd(), 'storage', 'audio'), bucket: readVar('S3_BUCKET') },
    { dir: join(process.cwd(), 'storage', 'covers'), bucket: readVar('S3_COVERS_BUCKET') }
  ];

  const pending: Pending[] = [];
  let skipped = 0;
  let totalBytes = 0;

  for (const { dir, bucket } of directories) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      console.log(`(sin ${dir}, se omite)`);
      continue;
    }

    process.stdout.write(`Revisando ${names.length} archivos de ${dir}… `);

    await inParallel(names, async (name) => {
      const path = join(dir, name);
      const info = await stat(path);
      if (!info.isFile()) return;

      const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
      if (!contentType) return;

      // Mismo nombre y mismo tamaño se da por subido. El nombre ya es el hash
      // del contenido, así que coincidir en ambos no deja mucho margen a que
      // sean archivos distintos.
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: name }));
        if (head.ContentLength === info.size) {
          skipped += 1;
          return;
        }
      } catch {
        // No está: toca subirlo.
      }

      pending.push({ path, key: name, bucket, size: info.size, contentType });
      totalBytes += info.size;
    });

    console.log('hecho.');
  }

  const gigabytes = (totalBytes / 1024 / 1024 / 1024).toFixed(2);
  console.log(`\n${skipped} ya estaban. Quedan ${pending.length} archivos (${gigabytes} GB).`);

  if (dryRun) {
    console.log('--dry-run: no se sube nada.');
    return;
  }
  if (pending.length === 0) return;

  let done = 0;
  let sentBytes = 0;
  const startedAt = Date.now();

  await inParallel(pending, async (file) => {
    // Se manda como flujo y no como Buffer: cargar un MP3 entero en memoria por
    // archivo no hace falta, y con diez subidas a la vez sería diez veces peor.
    await client.send(
      new PutObjectCommand({
        Bucket: file.bucket,
        Key: file.key,
        Body: createReadStream(file.path),
        ContentLength: file.size,
        ContentType: file.contentType
      })
    );

    done += 1;
    sentBytes += file.size;
    const minutes = (Date.now() - startedAt) / 1000 / 60;
    const speed = minutes > 0 ? (sentBytes / 1024 / 1024 / minutes).toFixed(1) : '—';
    process.stdout.write(`\r${done}/${pending.length}  ${speed} MB/min  ${file.key.slice(0, 40)}`.padEnd(90));
  });

  console.log(`\n\nListo: ${done} archivos subidos.`);
}

main().catch((error) => {
  console.error('\n', error);
  process.exit(1);
});
