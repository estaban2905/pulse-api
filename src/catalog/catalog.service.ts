import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog(apiUrl: string) {
    const absolute = (path: string) => (path.startsWith('http') ? path : `${apiUrl}${path}`);

    const [artists, albums, tracks] = await Promise.all([
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
      })
    ]);

    return {
      artists: artists.map((artist) => ({
        id: artist.id,
        slug: artist.slug,
        name: artist.name,
        bio: artist.bio,
        photoUrl: absolute(artist.photoUrl ?? '/media/covers/placeholder.png'),
        genres: artist.genres
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
        // Version the public URL so clients do not reuse the previous MP3
        // after an administrator replaces the immutable storage object.
        streamUrl: `${apiUrl}/tracks/${track.id}/stream?v=${track.updatedAt.getTime()}`
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
