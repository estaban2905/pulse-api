import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MediaSigningService } from '../config/media-signing.service';
import { StorageService } from '../storage/storage.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_TRACK_PREFIX = 'tr-';

/**
 * Catalog served from PostgreSQL.
 *
 * The response shape remains compatible with the original in-code catalog so
 * web and mobile clients do not depend on the persistence implementation.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaSigning: MediaSigningService,
    private readonly storage: StorageService
  ) {}

  async getCatalog(apiUrl: string) {
    // Las portadas salen apuntando al almacenamiento y el resto a este API. La
    // base guarda unas y otras igual, como rutas relativas, así que la
    // diferencia se resuelve aquí y no con una migración de datos.
    const absolute = (path: string) =>
      path.startsWith('http') ? path : (this.storage.publicMediaUrl(path) ?? `${apiUrl}${path}`);

    const [artists, albums, tracks, genres, moods, systemPlaylists, followerCounts, playCounts] = await Promise.all([
      this.prisma.artist.findMany({
        where: { tracks: { some: { isPublished: true } } },
        orderBy: { name: 'asc' }
      }),
      this.prisma.album.findMany({
        where: { tracks: { some: { isPublished: true } } },
        orderBy: [{ artistId: 'asc' }, { year: 'asc' }]
      }),
      this.prisma.track.findMany({
        where: { isPublished: true },
        include: { album: { select: { coverUrl: true } } },
        orderBy: { title: 'asc' }
      }),
      this.prisma.genre.findMany({ orderBy: { position: 'asc' } }),
      this.prisma.mood.findMany({
        orderBy: { position: 'asc' },
        include: { tracks: { select: { trackId: true, position: true }, orderBy: { position: 'asc' } } }
      }),
      this.prisma.playlist.findMany({
        where: { isSystem: true },
        orderBy: { position: 'asc' },
        include: { tracks: { select: { trackId: true, position: true }, orderBy: { position: 'asc' } } }
      }),
      // Dos agregaciones para todo el catálogo, no una consulta por entidad:
      // con casi mil pistas, lo segundo convertiría cada carga en una tormenta
      // de consultas.
      this.prisma.artistFollow.groupBy({ by: ['artistId'], _count: { artistId: true } }),
      this.prisma.listeningHistory.groupBy({ by: ['trackId'], _count: { trackId: true } })
    ]);

    const followersByArtist = new Map(followerCounts.map((row) => [row.artistId, row._count.artistId]));
    const playsByTrack = new Map(playCounts.map((row) => [row.trackId, row._count.trackId]));

    // Las escuchas de un artista son la suma de las de sus pistas, y se calcula
    // aquí en vez de con otra consulta porque las pistas ya están cargadas.
    const playsByArtist = new Map<string, number>();
    for (const track of tracks) {
      const plays = playsByTrack.get(track.id) ?? 0;
      if (plays) playsByArtist.set(track.artistId, (playsByArtist.get(track.artistId) ?? 0) + plays);
    }

    return {
      artists: artists.map((artist) => ({
        id: artist.id,
        slug: artist.slug,
        name: artist.name,
        bio: artist.bio,
        photoUrl: absolute(artist.photoUrl ?? '/media/covers/placeholder.png'),
        genres: artist.genres,
        // Cifras reales, no de escaparate: al principio serán cero, y eso es
        // más honesto que un número inventado que nunca cambia.
        followers: followersByArtist.get(artist.id) ?? 0,
        plays: playsByArtist.get(artist.id) ?? 0
      })),
      albums: albums.map((album) => ({
        id: album.id,
        slug: album.slug,
        title: album.title,
        artistId: album.artistId,
        year: album.year,
        type: album.type,
        genre: album.genre,
        coverUrl: absolute(album.coverUrl),
        accent: album.accent ?? '#4B5563'
      })),
      // storageKey is internal server state and must never be exposed.
      tracks: tracks.map((track) => ({
        id: track.id,
        slug: track.slug,
        title: track.title,
        artistId: track.artistId,
        albumId: track.albumId,
        duration: track.duration,
        genre: track.genre,
        explicit: track.explicit,
        codec: track.codec,
        coverUrl: absolute(track.coverUrl ?? track.album.coverUrl),
        // `v` versiona la URL para que nadie reutilice el MP3 anterior cuando
        // un administrador lo reemplaza; `exp` y `sig` son el permiso, que va
        // dentro de la URL porque un `<audio src>` no puede mandar cabeceras.
        streamUrl: `${apiUrl}/tracks/${track.id}/stream?${this.mediaSigning.signedQuery(
          track.id,
          track.updatedAt.getTime()
        )}`,
        plays: playsByTrack.get(track.id) ?? 0
      })),
      genres: genres.map((genre) => ({
        id: genre.id,
        slug: genre.slug,
        name: genre.name,
        color: genre.color
      })),
      moods: moods.map((mood) => ({
        id: mood.id,
        slug: mood.slug,
        name: mood.name,
        description: mood.description,
        icon: mood.icon,
        color: mood.color,
        trackIds: mood.tracks.map((entry) => entry.trackId)
      })),
      playlists: systemPlaylists.map((playlist) => ({
        id: playlist.id,
        title: playlist.title,
        description: playlist.description,
        coverUrl: playlist.coverUrl ? absolute(playlist.coverUrl) : null,
        trackIds: playlist.tracks.map((entry) => entry.trackId)
      }))
    };
  }

  /**
   * Resolves a public track identifier without mixing PostgreSQL types.
   * Current clients use UUIDs; the first web catalog used IDs such as
   * `tr-jigsaw`, which the seed stored under the canonical slug `jigsaw`.
   *
   * Never query Track.id with arbitrary input: the column is UUID and
   * PostgreSQL rejects a slug before Prisma can return null.
   */
  async getTrack(identifier: string) {
    const isUuid = UUID_PATTERN.test(identifier);
    let track = isUuid
      ? await this.prisma.track.findUnique({ where: { id: identifier } })
      : await this.prisma.track.findUnique({ where: { slug: identifier } });

    // A UUID-shaped value can still be an external slug. This fallback is safe
    // because slug is text and preserves the "UUID or slug" contract.
    if (!track && isUuid) {
      track = await this.prisma.track.findUnique({ where: { slug: identifier } });
    }

    // Compatibility with the previous static catalog: tr-jigsaw -> jigsaw.
    // An exact tr-* slug was checked first, so future imports remain valid.
    if (!track && identifier.startsWith(LEGACY_TRACK_PREFIX)) {
      const legacySlug = identifier.slice(LEGACY_TRACK_PREFIX.length);
      if (legacySlug) {
        track = await this.prisma.track.findUnique({ where: { slug: legacySlug } });
      }
    }

    if (!track) throw new NotFoundException('Track not found');
    return track;
  }
}
