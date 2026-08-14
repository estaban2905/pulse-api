import 'dotenv/config';

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Sube a la base de datos el contenido editorial que vivía en el cliente.
 *
 * Géneros, selecciones temáticas y playlists de Pulse estaban escritos en
 * `pulse-web/src/data/catalog.ts`, así que cambiarlos exigía desplegar la web.
 * Este script los deja en la base una sola vez; a partir de ahí el catálogo los
 * sirve y se pueden editar sin tocar código.
 *
 * Es idempotente: se puede volver a ejecutar sin duplicar nada.
 *
 * Uso: npm run seed:editorial
 */

/** Color por género. Solo se siembran los que existen en el catálogo. */
const GENRE_COLORS: Record<string, string> = {
  'Rock alternativo': '#E14B34',
  'Art rock': '#587891',
  Psicodelia: '#8C4D95',
  Indie: '#C98A4B',
  'Dream pop': '#8D8B87',
  Electrónica: '#D1B05B',
  'Indie rock': '#D65B46',
  Emo: '#686868',
  // Los tres que aparecieron al clasificar el catálogo importado
  // (`npm run classify:genres`), y que entre ellos suman más de la mitad de las
  // pistas: sin color propio saldrían los tres del mismo morado por defecto.
  Reggae: '#4F9A61',
  Grunge: '#7C6F64',
  Pop: '#D9738F'
};

/** Para un género del catálogo que nadie previó. */
const DEFAULT_GENRE_COLOR = '#7C6BFF';

/**
 * Géneros que no son un género.
 *
 * Los álbumes importados sin clasificar comparten esta etiqueta; convertirla en
 * un botón de descubrimiento sería ofrecer "todo lo demás" como si fuera un
 * estilo musical.
 */
const NOT_A_GENRE = new Set(['Sin clasificar', '']);

interface MoodSeed {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  /** Slugs de pista. Los que no estén en el catálogo se ignoran. */
  trackSlugs: string[];
}

const MOODS: MoodSeed[] = [
  {
    slug: 'concentracion',
    name: 'Concentración',
    description: 'Una sesión larga y envolvente.',
    icon: 'Target',
    color: '#587891',
    trackSlugs: ['disappear', 'let-it-happen', 'in-my-head', 'apocalypse']
  },
  {
    slug: 'viajar',
    name: 'Viajar',
    description: 'Psicodelia y rock para el camino.',
    icon: 'Plane',
    color: '#8C4D95',
    trackSlugs: ['let-it-happen', 'less-i-know', 'you-only-live-once', 'jigsaw']
  },
  {
    slug: 'relax',
    name: 'Relax',
    description: 'Baja las revoluciones.',
    icon: 'Waves',
    color: '#75A4BC',
    trackSlugs: ['no-surprises', 'disappear', 'cry', 'something-about-us']
  },
  {
    slug: 'fiesta',
    name: 'Fiesta',
    description: 'Ritmo y sintetizadores.',
    icon: 'PartyPopper',
    color: '#E14B34',
    trackSlugs: ['less-i-know', 'jigsaw', 'you-only-live-once', 'the-kill']
  }
];

interface PlaylistSeed {
  slug: string;
  title: string;
  description: string;
  coverSlug: string;
  trackSlugs: string[];
}

const PLAYLISTS: PlaylistSeed[] = [
  {
    slug: 'radiohead-esencial',
    title: 'Radiohead esencial',
    description: 'Tres etapas distintas de Radiohead.',
    coverSlug: 'kid-a',
    trackSlugs: ['jigsaw', 'no-surprises', 'disappear']
  },
  {
    slug: 'tame-impala',
    title: 'Tame Impala',
    description: 'Psicodelia, guitarras y sintetizadores.',
    coverSlug: 'currents',
    trackSlugs: ['let-it-happen', 'less-i-know', 'feels-like-backwards', 'vital-signs']
  },
  {
    slug: 'noche-lenta',
    title: 'Noche lenta',
    description: 'Dream pop e indie para bajar el ritmo.',
    coverSlug: 'cigarettes-after-sex',
    trackSlugs: ['apocalypse', 'cry', 'in-my-head', 'selfless']
  },
  {
    slug: 'rock-alternativo',
    title: 'Rock alternativo',
    description: 'Guitarras, piano y grandes estribillos.',
    coverSlug: 'black-parade',
    trackSlugs: ['jigsaw', 'somewhere-only-we-know', 'i-dont-love-you', 'you-only-live-once', 'the-kill']
  },
  {
    slug: 'electronica-y-psicodelia',
    title: 'Electrónica y psicodelia',
    description: 'Daft Punk y Tame Impala.',
    coverSlug: 'discovery',
    trackSlugs: ['something-about-us', 'let-it-happen', 'less-i-know', 'feels-like-backwards']
  }
];

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta DATABASE_URL. Copia .env.example a .env y ajústalo.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // --- Géneros: los que de verdad aparecen en el catálogo ---
    const albumGenres = await prisma.album.groupBy({ by: ['genre'], _count: { genre: true } });
    const genres = albumGenres
      .map((row) => row.genre)
      .filter((name) => !NOT_A_GENRE.has(name))
      .sort();

    for (const [index, name] of genres.entries()) {
      const data = { name, color: GENRE_COLORS[name] ?? DEFAULT_GENRE_COLOR, position: index };
      await prisma.genre.upsert({
        where: { slug: slugify(name) },
        create: { slug: slugify(name), ...data },
        update: data
      });
    }
    console.log(`Géneros sembrados: ${genres.length} (${genres.join(', ')})`);

    const skippedGenres = albumGenres.filter((row) => NOT_A_GENRE.has(row.genre));
    for (const row of skippedGenres) {
      console.log(`  omitido "${row.genre}": ${row._count.genre} álbumes sin clasificar`);
    }

    // --- Selecciones temáticas ---
    let moodTracksTotal = 0;
    for (const [index, mood] of MOODS.entries()) {
      const tracks = await prisma.track.findMany({
        where: { slug: { in: mood.trackSlugs }, isPublished: true },
        select: { id: true, slug: true }
      });
      const ordered = mood.trackSlugs
        .map((slug) => tracks.find((track) => track.slug === slug))
        .filter((track): track is { id: string; slug: string } => Boolean(track));

      const { slug, trackSlugs: _ignored, ...fields } = mood;
      const record = await prisma.mood.upsert({
        where: { slug },
        create: { slug, ...fields, position: index },
        update: { ...fields, position: index }
      });

      // Se reemplaza la lista entera para que reejecutar el script deje el
      // orden exacto de esta definición y no una mezcla con la anterior.
      await prisma.moodTrack.deleteMany({ where: { moodId: record.id } });
      await prisma.moodTrack.createMany({
        data: ordered.map((track, position) => ({ moodId: record.id, trackId: track.id, position }))
      });

      moodTracksTotal += ordered.length;
      const missing = mood.trackSlugs.length - ordered.length;
      console.log(`Mood "${mood.name}": ${ordered.length} pistas${missing ? ` (${missing} no están en el catálogo)` : ''}`);
    }

    // --- Playlists de Pulse ---
    for (const [index, playlist] of PLAYLISTS.entries()) {
      const tracks = await prisma.track.findMany({
        where: { slug: { in: playlist.trackSlugs }, isPublished: true },
        select: { id: true, slug: true }
      });
      const ordered = playlist.trackSlugs
        .map((slug) => tracks.find((track) => track.slug === slug))
        .filter((track): track is { id: string; slug: string } => Boolean(track));

      // Sin pistas no se publica: una playlist vacía en la portada es un hueco.
      if (ordered.length === 0) {
        console.log(`Playlist "${playlist.title}": omitida, ninguna de sus pistas está en el catálogo`);
        continue;
      }

      const cover = await prisma.album.findUnique({
        where: { slug: playlist.coverSlug },
        select: { coverUrl: true }
      });

      const existing = await prisma.playlist.findFirst({
        where: { isSystem: true, title: playlist.title },
        select: { id: true }
      });

      const fields = {
        title: playlist.title,
        description: playlist.description,
        coverUrl: cover?.coverUrl ?? null,
        isSystem: true,
        isPublic: true,
        position: index
      };

      const record = existing
        ? await prisma.playlist.update({ where: { id: existing.id }, data: fields })
        : await prisma.playlist.create({ data: fields });

      await prisma.playlistTrack.deleteMany({ where: { playlistId: record.id } });
      await prisma.playlistTrack.createMany({
        data: ordered.map((track, position) => ({ playlistId: record.id, trackId: track.id, position }))
      });

      const missing = playlist.trackSlugs.length - ordered.length;
      console.log(`Playlist "${playlist.title}": ${ordered.length} pistas${missing ? ` (${missing} no encontradas)` : ''}`);
    }

    console.log(`\nListo. ${genres.length} géneros, ${MOODS.length} moods (${moodTracksTotal} pistas) y ${PLAYLISTS.length} playlists de sistema.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
