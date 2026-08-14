import 'dotenv/config';

import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Pone género a lo que se importó sin él.
 *
 * El importador deja `Sin clasificar` cuando el archivo no traía la etiqueta, y
 * eso era el 85 % del catálogo: 929 de 1.098 pistas. Como los géneros ya viven
 * en la base de datos, arreglarlo no necesita desplegar nada —ni la API, ni la
 * web, ni la app—; basta con ejecutar esto y volver a pedir `/catalog`.
 *
 * El género se decide **por artista**, que es el dato fiable aquí: los archivos
 * no traen etiqueta y el título del álbum no dice el estilo. Las colaboraciones
 * —un rapero invitado en un disco de reggae— heredan el del disco en el que
 * aparecen, porque su fila de artista existe solo por esa pista.
 *
 * Es idempotente y conservador: solo toca lo que sigue en `Sin clasificar`, así
 * que nunca pisa una clasificación hecha a mano. Después conviene ejecutar
 * `npm run seed:editorial`, que rehace la tabla `Genre` a partir de los álbumes.
 *
 * Uso:
 *   npm run classify:genres -- --dry-run   (enseña lo que haría)
 *   npm run classify:genres
 */

/** La etiqueta que deja el importador cuando el archivo no traía género. */
const UNCLASSIFIED = 'Sin clasificar';

/**
 * Artista → géneros, del más general al más específico.
 *
 * El primero es el que se copia a sus álbumes y pistas; el resto solo enriquece
 * la ficha del artista. Los subgéneros no hace falta que existan en la tabla
 * `Genre`: esa la construye `seed:editorial` con los géneros de los álbumes, y
 * un subgénero de dos pistas sería un botón de descubrimiento que no lleva a
 * ninguna parte.
 */
const ARTIST_GENRES: Record<string, string[]> = {
  // --- Reggae y dancehall: la familia Marley y su entorno ---
  'Bob Marley and the Wailers': ['Reggae', 'Roots reggae'],
  'Bob Marley': ['Reggae', 'Roots reggae'],
  'Stephen Marley': ['Reggae', 'Roots reggae'],
  'Damian Marley': ['Reggae', 'Dancehall'],
  'Damian "Jr. Gong" Marley': ['Reggae', 'Dancehall'],
  'Jr. Gong': ['Reggae', 'Dancehall'],
  'Damian Marley, Wayne Marshall, Tarrus Riley & T.O.K.': ['Reggae', 'Dancehall'],
  'Kabaka Pyramid': ['Reggae'],
  Protoje: ['Reggae'],
  Capleton: ['Reggae', 'Dancehall'],
  Cham: ['Reggae', 'Dancehall'],
  Demarco: ['Reggae', 'Dancehall'],
  ETANA: ['Reggae'],
  'Queen Ifrica': ['Reggae'],
  'Yami Bolo': ['Reggae'],
  'Rygin king': ['Reggae', 'Dancehall'],
  'Mojo Morgan': ['Reggae'],
  'Roots of Creation': ['Reggae', 'Dub'],
  'Stick Figure': ['Reggae', 'Dub'],
  'Dukes Of Roots': ['Reggae'],
  Bonafide: ['Reggae'],
  'Bonafide Band': ['Reggae'],
  Daddigan: ['Reggae'],
  Junior: ['Reggae'],
  'Stefy De Cicco': ['Reggae'],
  'Salaam Remi': ['Reggae'],
  'DJ Ideal': ['Reggae'],
  'Seun Kuti': ['Reggae', 'Afrobeat'],

  // Invitados de un solo tema en discos de la familia Marley. Su estilo propio
  // es otro —casi todos son raperos—, pero aquí solo existen por esa pista.
  Eve: ['Reggae', 'Hip hop'],
  Treach: ['Reggae', 'Hip hop'],
  'Mr.Cheeks': ['Reggae', 'Hip hop'],
  Common: ['Reggae', 'Hip hop'],
  'Killer Mike': ['Reggae', 'Hip hop'],
  'Black Eyed Peas': ['Reggae', 'Hip hop'],
  'KAROL G': ['Reggae'],

  // --- Grunge ---
  Nirvana: ['Grunge', 'Rock alternativo'],

  // --- Rock alternativo ---
  Placebo: ['Rock alternativo', 'Britpop'],
  Lucybell: ['Rock alternativo', 'Rock chileno'],
  Coldplay: ['Rock alternativo', 'Britpop'],
  Evanescence: ['Rock alternativo', 'Rock gótico'],
  'The Cranberries': ['Rock alternativo'],
  'The Verve': ['Rock alternativo', 'Britpop'],
  'Snow Patrol': ['Rock alternativo'],
  'Cage The Elephant': ['Rock alternativo', 'Garage rock'],
  'The Neighbourhood': ['Rock alternativo', 'Indie'],
  'The 1975': ['Rock alternativo', 'Indie'],
  'The Smashing Pumpkins': ['Rock alternativo'],
  'The Offspring': ['Rock alternativo', 'Punk rock'],
  Radiohead: ['Rock alternativo', 'Art rock'],
  'The Doraemons': ['Rock alternativo'],
  'Nothing in my way': ['Rock alternativo', 'Piano rock'],

  // --- Dream pop ---
  'Still Corners': ['Dream pop', 'Ambient pop'],
  Slowdive: ['Dream pop', 'Shoegaze'],

  // --- Pop ---
  'Harry Styles': ['Pop', 'Pop rock'],
  'Miranda!': ['Pop', 'Electropop'],
  'Bruno Mars': ['Pop'],
  Akon: ['Pop', 'R&B'],
  Belanova: ['Pop', 'Electropop'],
  Kiesza: ['Pop', 'Dance'],
  'Maxi Trusso': ['Pop'],
  'Matt Simons': ['Pop'],
  'Jessie Reyez': ['Pop', 'R&B'],
  'Kevin Florez': ['Pop', 'Champeta'],

  // --- Electrónica ---
  Skrillex: ['Electrónica', 'Dubstep'],
  'DJ Snake': ['Electrónica'],
  'Duke Dumont': ['Electrónica', 'House'],
  Modjo: ['Electrónica', 'French house'],
  'Midnight Juggernauts': ['Electrónica', 'Psicodelia'],

  // --- Indie ---
  Dayglow: ['Indie', 'Indie pop'],
  'Tipling Rock': ['Indie'],
  'Delicate Steve': ['Indie', 'Indie rock'],
  'Foster The People': ['Indie', 'Indie pop'],

  // --- Psicodelia ---
  'Tash Sultana': ['Psicodelia', 'Indie']
};

interface Summary {
  artistsUpdated: number;
  albumsUpdated: number;
  tracksUpdated: number;
  byGenre: Map<string, number>;
  unmatchedArtists: string[];
  stillUnclassified: Array<{ name: string; tracks: number }>;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta DATABASE_URL. Copia .env.example a .env y ajústalo.');
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const summary: Summary = {
    artistsUpdated: 0,
    albumsUpdated: 0,
    tracksUpdated: 0,
    byGenre: new Map(),
    unmatchedArtists: [],
    stillUnclassified: []
  };

  try {
    const artists = await prisma.artist.findMany({
      select: {
        id: true,
        name: true,
        genres: true,
        _count: { select: { tracks: true } }
      }
    });

    const known = new Map(artists.map((artist) => [artist.name, artist]));

    // Un nombre del mapa que ya no está en el catálogo se avisa en vez de
    // ignorarse: casi siempre significa que el importador lo renombró.
    for (const name of Object.keys(ARTIST_GENRES)) {
      if (!known.has(name)) summary.unmatchedArtists.push(name);
    }

    for (const artist of artists) {
      const genres = ARTIST_GENRES[artist.name];
      if (!genres?.length) {
        if (artist._count.tracks > 0) {
          const pending = await prisma.track.count({
            where: { artistId: artist.id, genre: UNCLASSIFIED }
          });
          if (pending > 0) summary.stillUnclassified.push({ name: artist.name, tracks: pending });
        }
        continue;
      }

      const [primary] = genres;

      // Solo lo que sigue sin clasificar: si alguien ya corrigió un disco a
      // mano, este script no tiene por qué saber más que esa persona.
      const albums = await prisma.album.count({
        where: { artistId: artist.id, genre: UNCLASSIFIED }
      });
      const tracks = await prisma.track.count({
        where: { artistId: artist.id, genre: UNCLASSIFIED }
      });

      if (!dryRun) {
        if (albums > 0) {
          await prisma.album.updateMany({
            where: { artistId: artist.id, genre: UNCLASSIFIED },
            data: { genre: primary }
          });
        }
        if (tracks > 0) {
          await prisma.track.updateMany({
            where: { artistId: artist.id, genre: UNCLASSIFIED },
            data: { genre: primary }
          });
        }
        // La ficha del artista solo se rellena si estaba vacía, por la misma
        // razón: lo escrito a mano manda.
        if (artist.genres.length === 0) {
          await prisma.artist.update({ where: { id: artist.id }, data: { genres } });
        }
      }

      summary.albumsUpdated += albums;
      summary.tracksUpdated += tracks;
      if (artist.genres.length === 0) summary.artistsUpdated += 1;
      if (tracks > 0) summary.byGenre.set(primary, (summary.byGenre.get(primary) ?? 0) + tracks);
    }

    const remaining = await prisma.track.count({ where: { genre: UNCLASSIFIED } });
    const total = await prisma.track.count();

    console.log(dryRun ? '— SIMULACIÓN, no se ha escrito nada —\n' : '');
    console.log(`Artistas con ficha rellenada: ${summary.artistsUpdated}`);
    console.log(`Álbumes clasificados:         ${summary.albumsUpdated}`);
    console.log(`Pistas clasificadas:          ${summary.tracksUpdated}`);
    console.log('\nPistas por género:');
    for (const [genre, count] of [...summary.byGenre].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${genre}`);
    }

    if (summary.unmatchedArtists.length) {
      console.log('\nDel mapa, pero ya no están en el catálogo:');
      summary.unmatchedArtists.forEach((name) => console.log(`  - ${name}`));
    }

    if (summary.stillUnclassified.length) {
      console.log('\nSiguen sin clasificar (no están en el mapa):');
      summary.stillUnclassified
        .sort((a, b) => b.tracks - a.tracks)
        .forEach((row) => console.log(`  ${String(row.tracks).padStart(4)}  ${row.name}`));
    }

    const after = dryRun ? remaining - summary.tracksUpdated : remaining;
    console.log(`\nSin clasificar tras esto: ${after} de ${total} pistas.`);
    if (!dryRun) console.log('Siguiente paso: npm run seed:editorial (rehace la tabla Genre).');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
