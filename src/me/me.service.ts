import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { isUuid, LEGACY_PREFIX, slugCandidates } from '../common/identifiers';
import type {
  CreatePlaylistDto,
  UpdatePlaylistDto,
  UpdatePreferencesDto,
  UpdateProfileDto
} from './me.dto';

/** Tope de entradas de historial que se devuelven de una vez. */
const HISTORY_PAGE = 100;

/** Tope de pistas por playlist, para que un cliente roto no llene la tabla. */
const MAX_PLAYLIST_TRACKS = 1000;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Resolución de identificadores
  // ---------------------------------------------------------------------

  private async resolveTrackId(identifier: string): Promise<string> {
    if (isUuid(identifier)) {
      const byId = await this.prisma.track.findUnique({ where: { id: identifier }, select: { id: true } });
      if (byId) return byId.id;
    }
    for (const slug of slugCandidates(identifier, LEGACY_PREFIX.track)) {
      const found = await this.prisma.track.findUnique({ where: { slug }, select: { id: true } });
      if (found) return found.id;
    }
    throw new NotFoundException('No existe ninguna pista con ese identificador');
  }

  private async resolveAlbumId(identifier: string): Promise<string> {
    if (isUuid(identifier)) {
      const byId = await this.prisma.album.findUnique({ where: { id: identifier }, select: { id: true } });
      if (byId) return byId.id;
    }
    for (const slug of slugCandidates(identifier, LEGACY_PREFIX.album)) {
      const found = await this.prisma.album.findUnique({ where: { slug }, select: { id: true } });
      if (found) return found.id;
    }
    throw new NotFoundException('No existe ningún álbum con ese identificador');
  }

  private async resolveArtistId(identifier: string): Promise<string> {
    if (isUuid(identifier)) {
      const byId = await this.prisma.artist.findUnique({ where: { id: identifier }, select: { id: true } });
      if (byId) return byId.id;
    }
    for (const slug of slugCandidates(identifier, LEGACY_PREFIX.artist)) {
      const found = await this.prisma.artist.findUnique({ where: { slug }, select: { id: true } });
      if (found) return found.id;
    }
    throw new NotFoundException('No existe ningún artista con ese identificador');
  }

  // ---------------------------------------------------------------------
  // Cuenta
  // ---------------------------------------------------------------------

  /** Cambia los datos editables de la cuenta. El correo no es uno de ellos. */
  async updateProfile(userId: string, patch: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        createdAt: true
      }
    });
    return { ...user, createdAt: user.createdAt.toISOString() };
  }

  // ---------------------------------------------------------------------
  // Biblioteca
  // ---------------------------------------------------------------------

  /**
   * Todo lo que la aplicación necesita al arrancar, en una sola respuesta.
   *
   * Cinco viajes separados obligarían a la interfaz a dibujarse por partes;
   * esto llega entero y la biblioteca aparece de una vez.
   */
  async getLibrary(userId: string) {
    const [favourites, savedAlbums, followedArtists, history, preferences] = await Promise.all([
      this.prisma.favourite.findMany({
        where: { userId },
        select: { trackId: true },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.albumSave.findMany({
        where: { userId },
        select: { albumId: true },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.artistFollow.findMany({
        where: { userId },
        select: { artistId: true },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.listeningHistory.findMany({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        take: HISTORY_PAGE,
        select: { id: true, trackId: true, playedAt: true, progress: true, completed: true }
      }),
      this.prisma.userPreference.findUnique({ where: { userId } })
    ]);

    return {
      favourites: favourites.map((row) => row.trackId),
      savedAlbums: savedAlbums.map((row) => row.albumId),
      followedArtists: followedArtists.map((row) => row.artistId),
      history: history.map((entry) => ({
        id: entry.id,
        trackId: entry.trackId,
        playedAt: entry.playedAt.toISOString(),
        progress: entry.progress,
        completed: entry.completed
      })),
      preferences: preferences
        ? {
            theme: preferences.theme,
            language: preferences.language,
            streamQuality: preferences.streamQuality,
            downloadQuality: preferences.downloadQuality,
            autoplay: preferences.autoplay,
            crossfade: preferences.crossfade,
            normalize: preferences.normalize,
            privateSession: preferences.privateSession,
            favouriteGenres: preferences.favouriteGenres
          }
        : null
    };
  }

  /**
   * Las altas usan `createMany` con `skipDuplicates` en vez de comprobar antes
   * y crear después: así marcar dos veces el mismo favorito no es un error de
   * carrera, es simplemente una fila que ya estaba.
   */
  async addFavourite(userId: string, identifier: string): Promise<{ trackId: string }> {
    const trackId = await this.resolveTrackId(identifier);
    await this.prisma.favourite.createMany({ data: { userId, trackId }, skipDuplicates: true });
    return { trackId };
  }

  async removeFavourite(userId: string, identifier: string): Promise<void> {
    const trackId = await this.resolveTrackId(identifier);
    // `deleteMany` y no `delete`: borrar algo que no estaba no es un fallo.
    await this.prisma.favourite.deleteMany({ where: { userId, trackId } });
  }

  async saveAlbum(userId: string, identifier: string): Promise<{ albumId: string }> {
    const albumId = await this.resolveAlbumId(identifier);
    await this.prisma.albumSave.createMany({ data: { userId, albumId }, skipDuplicates: true });
    return { albumId };
  }

  async removeAlbum(userId: string, identifier: string): Promise<void> {
    const albumId = await this.resolveAlbumId(identifier);
    await this.prisma.albumSave.deleteMany({ where: { userId, albumId } });
  }

  async followArtist(userId: string, identifier: string): Promise<{ artistId: string }> {
    const artistId = await this.resolveArtistId(identifier);
    await this.prisma.artistFollow.createMany({ data: { userId, artistId }, skipDuplicates: true });
    return { artistId };
  }

  async unfollowArtist(userId: string, identifier: string): Promise<void> {
    const artistId = await this.resolveArtistId(identifier);
    await this.prisma.artistFollow.deleteMany({ where: { userId, artistId } });
  }

  // ---------------------------------------------------------------------
  // Historial
  // ---------------------------------------------------------------------

  async logPlay(userId: string, identifier: string, progress: number, completed: boolean) {
    const trackId = await this.resolveTrackId(identifier);
    const entry = await this.prisma.listeningHistory.create({
      data: { userId, trackId, progress, completed },
      select: { id: true, trackId: true, playedAt: true, progress: true, completed: true }
    });
    return { ...entry, playedAt: entry.playedAt.toISOString() };
  }

  /** El `userId` en el `where` es lo que impide borrar el historial ajeno. */
  async removeHistoryEntry(userId: string, entryId: string): Promise<void> {
    await this.prisma.listeningHistory.deleteMany({ where: { id: entryId, userId } });
  }

  async clearHistory(userId: string): Promise<void> {
    await this.prisma.listeningHistory.deleteMany({ where: { userId } });
  }

  // ---------------------------------------------------------------------
  // Preferencias
  // ---------------------------------------------------------------------

  /**
   * Las preferencias de una cuenta que todavía no ha guardado ninguna.
   *
   * Repiten los `@default` de `UserPreference` en el schema, y tienen que
   * seguir haciéndolo: si divergen, un cliente vería un valor antes de tocar
   * nada y otro distinto en cuanto guardara cualquier otra preferencia.
   */
  private static readonly DEFAULT_PREFERENCES = {
    theme: 'dark',
    language: 'es',
    streamQuality: 'high',
    downloadQuality: 'high',
    autoplay: true,
    crossfade: 0,
    normalize: false,
    privateSession: false,
    favouriteGenres: [] as string[]
  };

  private static toPreferences(row: {
    theme: string;
    language: string;
    streamQuality: string;
    downloadQuality: string;
    autoplay: boolean;
    crossfade: number;
    normalize: boolean;
    privateSession: boolean;
    favouriteGenres: string[];
  }) {
    return {
      theme: row.theme,
      language: row.language,
      streamQuality: row.streamQuality,
      downloadQuality: row.downloadQuality,
      autoplay: row.autoplay,
      crossfade: row.crossfade,
      normalize: row.normalize,
      privateSession: row.privateSession,
      favouriteGenres: row.favouriteGenres
    };
  }

  /**
   * Preferencias efectivas, nunca nulas.
   *
   * `/me/library` las declara anulables, pero el alta ya crea la fila
   * (`preferences: { create: {} }` en `AuthService.register`), así que ese
   * `null` solo le puede tocar a una cuenta creada por otra vía —el script de
   * administración, o una fila anterior a esa tabla—. Aquí se responde igual en
   * los dos casos: quien pregunta qué ajustes aplicar necesita valores, no un
   * hueco que tendría que rellenar con su propia copia de los mismos defectos,
   * que es justo como se desincronizan los clientes.
   */
  async getPreferences(userId: string) {
    const preferences = await this.prisma.userPreference.findUnique({ where: { userId } });
    return preferences ? MeService.toPreferences(preferences) : MeService.DEFAULT_PREFERENCES;
  }

  async updatePreferences(userId: string, patch: UpdatePreferencesDto) {
    const preferences = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: patch
    });

    return MeService.toPreferences(preferences);
  }

  // ---------------------------------------------------------------------
  // Playlists
  // ---------------------------------------------------------------------

  private static toPlaylist(row: {
    id: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    isPublic: boolean;
    collaborative: boolean;
    updatedAt: Date;
    tracks: { trackId: string; position: number }[];
  }) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      coverUrl: row.coverUrl,
      isPublic: row.isPublic,
      collaborative: row.collaborative,
      updatedAt: row.updatedAt.toISOString(),
      trackIds: [...row.tracks].sort((a, b) => a.position - b.position).map((track) => track.trackId)
    };
  }

  private static readonly playlistShape = {
    id: true,
    title: true,
    description: true,
    coverUrl: true,
    isPublic: true,
    collaborative: true,
    updatedAt: true,
    tracks: { select: { trackId: true, position: true } }
  } as const;

  async listPlaylists(userId: string) {
    const rows = await this.prisma.playlist.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      select: MeService.playlistShape
    });
    return rows.map(MeService.toPlaylist);
  }

  async createPlaylist(userId: string, dto: CreatePlaylistDto) {
    const trackIds = await this.resolveTrackIds(dto.trackIds ?? []);

    const playlist = await this.prisma.playlist.create({
      data: {
        ownerId: userId,
        title: dto.title,
        description: dto.description,
        coverUrl: dto.coverUrl,
        tracks: { create: trackIds.map((trackId, position) => ({ trackId, position, addedById: userId })) }
      },
      select: MeService.playlistShape
    });
    return MeService.toPlaylist(playlist);
  }

  /**
   * Comprueba la propiedad dentro del `where`, no después de leer.
   *
   * Leer primero y comparar el dueño en JavaScript deja la puerta abierta a
   * que una rama olvide la comparación; si la condición vive en la consulta,
   * una playlist ajena sencillamente no existe.
   */
  private async assertOwned(userId: string, playlistId: string): Promise<void> {
    const owned = await this.prisma.playlist.findFirst({
      where: { id: playlistId, ownerId: userId },
      select: { id: true }
    });
    // 404 y no 403: a quien no es dueño no se le confirma que la playlist exista.
    if (!owned) throw new NotFoundException('No existe ninguna playlist tuya con ese identificador');
  }

  async updatePlaylist(userId: string, playlistId: string, dto: UpdatePlaylistDto) {
    if (!isUuid(playlistId)) throw new NotFoundException('No existe ninguna playlist tuya con ese identificador');
    await this.assertOwned(userId, playlistId);

    const { trackIds, ...fields } = dto;

    // Reemplazar la lista entera en lugar de añadir, quitar y reordenar por
    // separado: el cliente ya conoce el orden final, y hacerlo en una
    // transacción evita que un fallo a medias deje posiciones duplicadas
    // contra el índice único (playlistId, position).
    if (trackIds) {
      const resolved = await this.resolveTrackIds(trackIds);
      await this.prisma.$transaction([
        this.prisma.playlistTrack.deleteMany({ where: { playlistId } }),
        this.prisma.playlistTrack.createMany({
          data: resolved.map((trackId, position) => ({ playlistId, trackId, position, addedById: userId }))
        })
      ]);
    }

    const playlist = await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { ...fields, updatedAt: new Date() },
      select: MeService.playlistShape
    });
    return MeService.toPlaylist(playlist);
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<void> {
    if (!isUuid(playlistId)) return;
    // Sin lectura previa: el `ownerId` en el `where` ya limita el borrado a lo propio.
    await this.prisma.playlist.deleteMany({ where: { id: playlistId, ownerId: userId } });
  }

  /**
   * Traduce identificadores públicos a UUIDs, quitando repetidos.
   *
   * Los duplicados no se pueden dejar pasar: `PlaylistTrack` tiene clave
   * primaria (playlistId, trackId) y la misma pista dos veces reventaría la
   * inserción entera.
   */
  private async resolveTrackIds(identifiers: string[]): Promise<string[]> {
    if (identifiers.length > MAX_PLAYLIST_TRACKS) {
      throw new BadRequestException(`Una playlist no puede pasar de ${MAX_PLAYLIST_TRACKS} pistas`);
    }

    const resolved: string[] = [];
    const seen = new Set<string>();
    for (const identifier of identifiers) {
      const trackId = await this.resolveTrackId(identifier);
      if (seen.has(trackId)) continue;
      seen.add(trackId);
      resolved.push(trackId);
    }
    return resolved;
  }
}
