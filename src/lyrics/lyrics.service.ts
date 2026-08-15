import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { isUuid, LEGACY_PREFIX, slugCandidates } from '../common/identifiers';
import { LyricStatus } from '../../generated/prisma/enums';
import { parseLrc, parsePlain, type LyricLine } from './lrc';

/** Lo que el proveedor devuelve, de lo que solo se usan estos tres campos. */
interface ProviderPayload {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** Una letra ya resuelta, venga de la base o del proveedor. */
export interface LyricsResult {
  status: Lowercase<keyof typeof LyricStatus>;
  source: string;
  /** Cuándo se preguntó al proveedor. Sirve para explicar una letra vieja. */
  fetchedAt: string;
  lines: LyricLine[];
}

/** La pista con lo que el proveedor necesita para identificar la grabación. */
interface TrackForLookup {
  id: string;
  title: string;
  duration: number;
  artist: { name: string };
  album: { title: string };
}

@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);

  /** Base comunitaria, sin clave y con CORS abierto. */
  private static readonly PROVIDER_URL = 'https://lrclib.net/api/get';
  private static readonly PROVIDER_NAME = 'lrclib';

  /**
   * Un proveedor lento no puede colgar la petición del cliente: pasado este
   * tiempo se responde con lo que haya en la base, o se admite que no se sabe.
   */
  private static readonly TIMEOUT_MS = 5_000;

  /**
   * Cuánto vale un «no hay letra».
   *
   * LRCLIB crece con lo que sube la gente, así que la ausencia de hoy puede
   * dejar de serlo. Una letra encontrada, en cambio, no caduca nunca: no va a
   * desaparecer, y volver a preguntar solo gastaría la cuota de ambos.
   */
  private static readonly MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

  /**
   * Consultas en vuelo, por pista.
   *
   * Cuando una canción se estrena, los oyentes abren la letra a la vez y
   * ninguno la tiene cacheada todavía. Sin esta cola, cada uno sale a LRCLIB
   * con la misma pregunta y todos escriben la misma fila.
   */
  private readonly inFlight = new Map<string, Promise<LyricsResult>>();

  constructor(private readonly prisma: PrismaService) {}

  async getForTrack(identifier: string): Promise<LyricsResult> {
    const track = await this.resolveTrack(identifier);

    const cached = await this.prisma.lyric.findUnique({ where: { trackId: track.id } });
    if (cached && !LyricsService.isStale(cached.status, cached.fetchedAt)) {
      return LyricsService.toResult(cached);
    }

    const pending = this.inFlight.get(track.id);
    if (pending) return pending;

    const lookup = this.lookup(track, cached).finally(() => this.inFlight.delete(track.id));
    this.inFlight.set(track.id, lookup);
    return lookup;
  }

  /**
   * Pregunta al proveedor y guarda lo que conteste.
   *
   * Si el proveedor falla, una letra vieja vale más que un error: se devuelve
   * la que hubiera. Solo cuando no hay absolutamente nada se admite el fallo,
   * porque entonces el cliente no puede mostrar más que un hueco y merece saber
   * que la culpa no es de la canción.
   */
  private async lookup(
    track: TrackForLookup,
    cached: { status: LyricStatus; source: string; syncedText: string | null; plainText: string | null; fetchedAt: Date } | null
  ): Promise<LyricsResult> {
    let payload: ProviderPayload;
    try {
      payload = await this.askProvider(track);
    } catch (reason) {
      if (cached) {
        this.logger.warn(`LRCLIB no respondió para «${track.title}»; se sirve la letra guardada`);
        return LyricsService.toResult(cached);
      }
      this.logger.warn(`LRCLIB no respondió para «${track.title}»: ${String(reason)}`);
      throw new ServiceUnavailableException('El proveedor de letras no está disponible. Inténtalo más tarde.');
    }

    const stored = await this.prisma.lyric.upsert({
      where: { trackId: track.id },
      create: { trackId: track.id, ...LyricsService.fromPayload(payload) },
      update: { ...LyricsService.fromPayload(payload), fetchedAt: new Date() }
    });

    return LyricsService.toResult(stored);
  }

  /**
   * Un 404 del proveedor no es un fallo: es la respuesta «no la tengo», y hay
   * que guardarla para no volver a preguntar en cada reproducción. Cualquier
   * otro código sí es un fallo, y se propaga para que no se cachee.
   */
  private async askProvider(track: TrackForLookup): Promise<ProviderPayload> {
    const params = new URLSearchParams({
      track_name: track.title,
      artist_name: track.artist.name,
      album_name: track.album.title,
      duration: String(Math.round(track.duration))
    });

    const response = await fetch(`${LyricsService.PROVIDER_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'pulse-api (https://github.com/pulse-music)' },
      signal: AbortSignal.timeout(LyricsService.TIMEOUT_MS)
    });

    if (response.status === 404) return {};
    if (!response.ok) throw new Error(`LRCLIB respondió ${response.status}`);

    return (await response.json()) as ProviderPayload;
  }

  /** Traduce la respuesta del proveedor a lo que se guarda. */
  private static fromPayload(payload: ProviderPayload) {
    const synced = payload.syncedLyrics?.trim() || null;
    const plain = payload.plainLyrics?.trim() || null;

    // El orden importa: una canción instrumental puede traer igualmente un LRC
    // con solo marcas, y anunciarla como sincronizada sería enseñar una letra
    // vacía en lugar de decir que no la tiene.
    const status = payload.instrumental
      ? LyricStatus.INSTRUMENTAL
      : synced
        ? LyricStatus.SYNCED
        : plain
          ? LyricStatus.PLAIN
          : LyricStatus.MISSING;

    return { status, syncedText: synced, plainText: plain, source: LyricsService.PROVIDER_NAME };
  }

  private static isStale(status: LyricStatus, fetchedAt: Date): boolean {
    if (status !== LyricStatus.MISSING) return false;
    return Date.now() - fetchedAt.getTime() > LyricsService.MISSING_TTL_MS;
  }

  private static toResult(row: {
    status: LyricStatus;
    source: string;
    syncedText: string | null;
    plainText: string | null;
    fetchedAt: Date;
  }): LyricsResult {
    // Un LRC que no produce ni una línea legible se degrada a texto plano en
    // lugar de anunciarse como sincronizado y no pintar nada.
    let status = row.status;
    let lines: LyricLine[] = [];

    if (status === LyricStatus.SYNCED && row.syncedText) {
      lines = parseLrc(row.syncedText);
      if (!lines.length) status = LyricStatus.PLAIN;
    }

    if (!lines.length && status === LyricStatus.PLAIN && row.plainText) {
      lines = parsePlain(row.plainText);
    }

    return {
      status: status.toLowerCase() as LyricsResult['status'],
      source: row.source,
      fetchedAt: row.fetchedAt.toISOString(),
      lines
    };
  }

  /**
   * Resuelve el identificador público a la pista, con lo que hace falta para
   * preguntar por ella. Nunca manda un slug a una columna UUID.
   */
  private async resolveTrack(identifier: string): Promise<TrackForLookup> {
    const shape = {
      id: true,
      title: true,
      duration: true,
      artist: { select: { name: true } },
      album: { select: { title: true } }
    } as const;

    if (isUuid(identifier)) {
      const byId = await this.prisma.track.findUnique({ where: { id: identifier }, select: shape });
      if (byId) return byId;
    }

    for (const slug of slugCandidates(identifier, LEGACY_PREFIX.track)) {
      const bySlug = await this.prisma.track.findUnique({ where: { slug }, select: shape });
      if (bySlug) return bySlug;
    }

    throw new NotFoundException('No existe ninguna pista con ese identificador');
  }
}
