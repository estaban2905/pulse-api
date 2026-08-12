/**
 * Importa a PostgreSQL el manifiesto que produce pulse-dl.
 *
 * Uso:
 *   node scripts/import-manifest.ts ../pulse-dl/salida
 *   node scripts/import-manifest.ts ../pulse-dl/salida --dry-run
 *
 * Es idempotente: la clave de cada entidad es su `slug`, así que repetir la
 * importación actualiza en vez de duplicar. Eso permite volver a lanzarla tras
 * corregir metadata sin ensuciar la base.
 *
 * No hay dependencia de código con pulse-dl: lo único compartido es el formato
 * del manifiesto.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { PrismaClient } from '../generated/prisma/client';

type ManifestArtist = { slug: string; name: string; genres?: string[] };
type ManifestAlbum = {
  slug: string;
  title: string;
  artistSlug: string;
  year: number | null;
  cover: string | null;
};
type ManifestTrack = {
  slug: string;
  title: string;
  artistSlug: string;
  albumSlug: string | null;
  duration: number;
  codec: string;
  bitrate: number | null;
  fileName: string;
  sizeBytes: number;
  sourceUrl?: string;
};
type Manifest = {
  manifestVersion: number;
  artists: ManifestArtist[];
  albums: ManifestAlbum[];
  tracks: ManifestTrack[];
};

/** El esquema exige estos campos y el manifiesto no siempre los trae. */
const GENERO_POR_DEFECTO = 'Sin clasificar';
const PORTADA_POR_DEFECTO = '/media/covers/placeholder.png';

const CODECS = new Set(['MP3', 'AAC', 'FLAC']);

type Omitida = { titulo: string; motivo: string };

type Resumen = {
  artistas: number;
  albumes: number;
  pistas: number;
  actualizadas: number;
  archivos: number;
  portadas: number;
  omitidas: Omitida[];
};

function resumenVacio(): Resumen {
  return {
    artistas: 0, albumes: 0, pistas: 0, actualizadas: 0,
    archivos: 0, portadas: 0, omitidas: []
  };
}

function leerManifiesto(carpeta: string): Manifest {
  const ruta = join(carpeta, 'manifest.json');
  if (!existsSync(ruta)) {
    throw new Error(`No se encontró ${ruta}. ¿Exportaste el manifiesto desde pulse-dl?`);
  }
  const datos = JSON.parse(readFileSync(ruta, 'utf8')) as Manifest;
  if (datos.manifestVersion !== 1) {
    throw new Error(
      `Versión de manifiesto no soportada: ${datos.manifestVersion}. Este importador entiende la 1.`
    );
  }
  return datos;
}

function crearCliente(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL. Copia .env.example a .env y ajústalo.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/**
 * Copia un archivo solo si cambió.
 *
 * Comparar tamaños evita reescribir cientos de megas en cada importación, que
 * es lo normal cuando solo se corrigió un año en la metadata.
 */
function copiarSiCambio(origen: string, destino: string): boolean {
  if (!existsSync(origen)) return false;
  if (existsSync(destino) && statSync(destino).size === statSync(origen).size) {
    return false;
  }
  mkdirSync(resolve(destino, '..'), { recursive: true });
  copyFileSync(origen, destino);
  return true;
}

/**
 * Nombre de archivo estable y seguro para la URL de streaming.
 *
 * Los nombres que genera pulse-dl son legibles ("Placebo - This Picture.mp3")
 * pero llevan espacios y acentos. Dentro de storage conviene un identificador
 * plano; el título bonito ya vive en la base de datos.
 */
function claveDeAlmacenamiento(slugPista: string, nombreOriginal: string): string {
  const extension = nombreOriginal.split('.').pop() ?? 'mp3';
  return `${slugPista}.${extension}`;
}

function generoDe(artista: ManifestArtist | undefined): string {
  return artista?.genres?.[0] ?? GENERO_POR_DEFECTO;
}

/** Motivo por el que una pista no puede entrar, o null si está lista. */
function porQueNoEntra(pista: ManifestTrack, carpeta: string): string | null {
  if (!CODECS.has(pista.codec)) return `codec no soportado: ${pista.codec}`;
  if (!pista.duration) return 'sin duración';
  if (!pista.artistSlug) return 'sin artista';
  if (!existsSync(join(carpeta, 'audio', pista.fileName))) {
    return `falta el archivo ${pista.fileName}`;
  }
  return null;
}

/**
 * Comprueba el manifiesto sin tocar la base de datos ni copiar nada.
 *
 * Sirve para validar una tanda antes de tener PostgreSQL levantado, y para
 * ver qué se quedaría fuera antes de escribir.
 */
function validar(manifiesto: Manifest, carpeta: string): Resumen {
  const resumen = resumenVacio();
  resumen.artistas = manifiesto.artists.length;
  resumen.albumes = manifiesto.albums.length;

  const slugsArtista = new Set(manifiesto.artists.map((a) => a.slug));

  for (const album of manifiesto.albums) {
    if (!slugsArtista.has(album.artistSlug)) {
      resumen.omitidas.push({ titulo: album.title, motivo: 'artista inexistente' });
      resumen.albumes--;
    }
  }

  for (const pista of manifiesto.tracks) {
    const motivo = porQueNoEntra(pista, carpeta)
      ?? (slugsArtista.has(pista.artistSlug) ? null : 'artista inexistente');
    if (motivo) {
      resumen.omitidas.push({ titulo: pista.title, motivo });
      continue;
    }
    resumen.pistas++;
  }

  return resumen;
}

async function importar(
  manifiesto: Manifest,
  carpeta: string,
  prisma: PrismaClient
): Promise<Resumen> {
  const resumen = resumenVacio();
  const artistaPorSlug = new Map(manifiesto.artists.map((a) => [a.slug, a]));

  const destinoAudio = join(process.cwd(), 'storage', 'audio');
  const destinoPortadas = join(process.cwd(), 'storage', 'covers');

  for (const artista of manifiesto.artists) {
    await prisma.artist.upsert({
      where: { slug: artista.slug },
      create: {
        slug: artista.slug,
        name: artista.name,
        genres: artista.genres ?? []
      },
      // El nombre puede haberse corregido en la mesa de revisión; los géneros
      // no se pisan porque pueden haberse curado a mano en la base.
      update: { name: artista.name }
    });
    resumen.artistas++;
  }

  for (const album of manifiesto.albums) {
    const artista = await prisma.artist.findUnique({ where: { slug: album.artistSlug } });
    if (!artista) {
      resumen.omitidas.push({ titulo: album.title, motivo: 'artista inexistente' });
      continue;
    }

    let importedCoverUrl: string | null = null;
    if (album.cover) {
      const origen = join(carpeta, album.cover);
      const nombre = basename(album.cover);
      if (copiarSiCambio(origen, join(destinoPortadas, nombre))) resumen.portadas++;
      if (existsSync(origen)) importedCoverUrl = `/media/covers/${nombre}`;
    }

    await prisma.album.upsert({
      where: { slug: album.slug },
      create: {
        slug: album.slug,
        artistId: artista.id,
        title: album.title,
        // El esquema exige un año; sin él la pista no debería haber salido de
        // pulse-dl, pero preferimos un valor visible a un fallo opaco.
        year: album.year ?? 0,
        genre: generoDe(artistaPorSlug.get(album.artistSlug)),
        coverUrl: importedCoverUrl ?? PORTADA_POR_DEFECTO
      },
      // Una importacion sin portada no debe degradar arte curado previamente.
      // Solo reemplazamos coverUrl cuando el archivo fuente fue validado.
      update: {
        title: album.title,
        year: album.year ?? 0,
        ...(importedCoverUrl ? { coverUrl: importedCoverUrl } : {})
      }
    });
    resumen.albumes++;
  }

  for (const pista of manifiesto.tracks) {
    const motivo = porQueNoEntra(pista, carpeta);
    if (motivo) {
      resumen.omitidas.push({ titulo: pista.title, motivo });
      continue;
    }

    const artista = await prisma.artist.findUnique({ where: { slug: pista.artistSlug } });
    if (!artista) {
      resumen.omitidas.push({ titulo: pista.title, motivo: 'artista inexistente' });
      continue;
    }

    // El esquema exige álbum en toda pista. Cuando el manifiesto no lo trae, se
    // crea un lanzamiento de tipo SINGLE con el nombre de la canción, que es lo
    // que representa de verdad una pista suelta.
    let albumSlug = pista.albumSlug;
    if (!albumSlug) {
      albumSlug = `single-${pista.slug}`;
      await prisma.album.upsert({
        where: { slug: albumSlug },
        create: {
          slug: albumSlug,
          artistId: artista.id,
          title: pista.title,
          year: 0,
          type: 'SINGLE',
          genre: generoDe(artistaPorSlug.get(pista.artistSlug)),
          coverUrl: PORTADA_POR_DEFECTO
        },
        update: {}
      });
    }

    const album = await prisma.album.findUnique({ where: { slug: albumSlug } });
    if (!album) {
      resumen.omitidas.push({ titulo: pista.title, motivo: `álbum inexistente: ${albumSlug}` });
      continue;
    }

    const origen = join(carpeta, 'audio', pista.fileName);
    const clave = claveDeAlmacenamiento(pista.slug, pista.fileName);
    if (copiarSiCambio(origen, join(destinoAudio, clave))) resumen.archivos++;

    const tamano = BigInt(pista.sizeBytes || statSync(origen).size);
    const yaExistia = await prisma.track.findUnique({ where: { slug: pista.slug } });

    await prisma.track.upsert({
      where: { slug: pista.slug },
      create: {
        slug: pista.slug,
        artistId: artista.id,
        albumId: album.id,
        title: pista.title,
        duration: pista.duration,
        genre: generoDe(artistaPorSlug.get(pista.artistSlug)),
        codec: pista.codec as 'MP3' | 'AAC' | 'FLAC',
        storageKey: clave,
        fileSizeBytes: tamano,
        isPublished: true
      },
      update: {
        title: pista.title,
        duration: pista.duration,
        albumId: album.id,
        storageKey: clave,
        fileSizeBytes: tamano
      }
    });

    if (yaExistia) resumen.actualizadas++;
    resumen.pistas++;
  }

  return resumen;
}

function informar(resumen: Resumen, dryRun: boolean): void {
  console.log('');
  console.log(`  artistas   ${resumen.artistas}`);
  console.log(`  álbumes    ${resumen.albumes}`);
  console.log(`  pistas     ${resumen.pistas}  (${resumen.actualizadas} ya existían)`);
  if (!dryRun) {
    console.log(`  copiados   ${resumen.archivos} audios, ${resumen.portadas} portadas`);
  }
  for (const omitida of resumen.omitidas) {
    console.log(`  omitida    ${omitida.titulo} — ${omitida.motivo}`);
  }
  console.log('');
  console.log(dryRun ? 'Simulación: nada se escribió.' : 'Importación completada.');
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const dryRun = argumentos.includes('--dry-run');
  const carpeta = resolve(argumentos.find((a) => !a.startsWith('--')) ?? '../pulse-dl/salida');

  console.log(`Importando desde ${carpeta}${dryRun ? '  (simulación)' : ''}`);
  const manifiesto = leerManifiesto(carpeta);

  if (dryRun) {
    informar(validar(manifiesto, carpeta), true);
    return;
  }

  const prisma = crearCliente();
  try {
    informar(await importar(manifiesto, carpeta, prisma), false);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`\nFalló la importación: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
