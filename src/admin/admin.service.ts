import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AudioCodec } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UUID_PATTERN, type PublishTrackDto, type UpdateAlbumDto, type UpdateTrackDto } from './admin.dto';

const LEGACY_TRACK_PREFIX = 'tr-';

/** El esquema exige género y portada; ninguna fuente los aporta siempre. */
const DEFAULT_GENRE = 'Sin clasificar';
const DEFAULT_COVER = '/media/covers/placeholder.png';

const trackRelations = {
  artist: { select: { name: true } },
  album: {
    select: {
      id: true,
      title: true,
      coverUrl: true,
      artistId: true,
      artist: { select: { name: true } }
    }
  }
} as const;

interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

function absoluteUrl(apiUrl: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;

  // Raw MP3s may begin directly with an MPEG audio frame instead of ID3.
  const scanLength = Math.min(buffer.length - 1, 4096);
  for (let index = 0; index < scanLength; index += 1) {
    const first = buffer[index];
    const second = buffer[index + 1];
    if (first !== 0xff || (second & 0xe0) !== 0xe0) continue;
    const version = (second >> 3) & 0x03;
    const layer = (second >> 1) & 0x03;
    if (version === 0x01 || layer === 0x00) continue;
    const third = buffer[index + 2];
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    if (bitrateIndex !== 0 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03) return true;
  }
  return false;
}

function imageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}

async function writeStableFile(directory: string, filename: string, buffer: Buffer): Promise<void> {
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, filename), buffer, { flag: fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code !== 'EEXIST') throw error;
    // Same content hash means the existing immutable file can be reused.
  }
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  private async findTrack(identifier: string) {
    const isUuid = UUID_PATTERN.test(identifier);
    let track = isUuid
      ? await this.prisma.track.findUnique({ where: { id: identifier }, include: trackRelations })
      : await this.prisma.track.findUnique({ where: { slug: identifier }, include: trackRelations });

    if (!track && isUuid) {
      track = await this.prisma.track.findUnique({ where: { slug: identifier }, include: trackRelations });
    }
    if (!track && identifier.startsWith(LEGACY_TRACK_PREFIX)) {
      const slug = identifier.slice(LEGACY_TRACK_PREFIX.length);
      if (slug) track = await this.prisma.track.findUnique({ where: { slug }, include: trackRelations });
    }
    if (!track) throw new NotFoundException('Track not found');
    return track;
  }

  private toAdminTrack(track: Awaited<ReturnType<AdminService['findTrack']>>, apiUrl: string) {
    const albumCoverUrl = absoluteUrl(apiUrl, track.album.coverUrl);
    return {
      id: track.id,
      slug: track.slug,
      title: track.title,
      artistId: track.artistId,
      artistName: track.artist.name,
      albumId: track.albumId,
      albumTitle: track.album.title,
      duration: track.duration,
      genre: track.genre,
      explicit: track.explicit,
      codec: track.codec,
      coverUrl: track.coverUrl ? absoluteUrl(apiUrl, track.coverUrl) : albumCoverUrl,
      ownCoverUrl: track.coverUrl,
      albumCoverUrl,
      streamUrl: `${apiUrl}/tracks/${track.id}/stream?v=${track.updatedAt.getTime()}`,
      fileSizeBytes: Number(track.fileSizeBytes),
      isPublished: track.isPublished,
      updatedAt: track.updatedAt.toISOString()
    };
  }

  async listTracks(apiUrl: string) {
    const [tracks, albums, artists] = await Promise.all([
      this.prisma.track.findMany({ include: trackRelations, orderBy: [{ title: 'asc' }, { id: 'asc' }] }),
      this.prisma.album.findMany({
        include: { artist: { select: { name: true } } },
        orderBy: [{ artist: { name: 'asc' } }, { year: 'desc' }, { title: 'asc' }]
      }),
      // Los artistas iban desnormalizados dentro de cada pista y cada álbum, de
      // los que solo salía el nombre. Su foto no estaba en ninguna parte de este
      // payload, así que un cliente que quisiera usarla —para dar carátula a un
      // recopilatorio, por ejemplo— tenía que ir a pedirla al catálogo público.
      this.prisma.artist.findMany({
        select: { id: true, slug: true, name: true, photoUrl: true },
        orderBy: { name: 'asc' }
      })
    ]);

    return {
      tracks: tracks.map((track) => this.toAdminTrack(track, apiUrl)),
      albums: albums.map((album) => ({
        id: album.id,
        slug: album.slug,
        title: album.title,
        artistId: album.artistId,
        artistName: album.artist.name,
        year: album.year,
        coverUrl: absoluteUrl(apiUrl, album.coverUrl)
      })),
      artists: artists.map((artist) => ({
        id: artist.id,
        slug: artist.slug,
        name: artist.name,
        // Sin foto se devuelve null, no el placeholder: quien la vaya a copiar
        // necesita distinguir «tiene retrato» de «tiene el relleno de todos»,
        // y el catálogo público, que sí rellena, no puede responder a eso.
        photoUrl: artist.photoUrl ? absoluteUrl(apiUrl, artist.photoUrl) : null
      }))
    };
  }

  async updateTrack(identifier: string, input: UpdateTrackDto, apiUrl: string) {
    const existing = await this.findTrack(identifier);
    let artistId = existing.artistId;
    if (input.albumId) {
      const album = await this.prisma.album.findUnique({ where: { id: input.albumId }, select: { artistId: true } });
      if (!album) throw new BadRequestException('Selected album does not exist');
      artistId = album.artistId;
    }

    const track = await this.prisma.track.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        genre: input.genre,
        explicit: input.explicit,
        albumId: input.albumId,
        artistId: input.albumId ? artistId : undefined,
        isPublished: input.isPublished,
        coverUrl: input.coverUrl
      },
      include: trackRelations
    });
    return this.toAdminTrack(track, apiUrl);
  }

  async replaceAudio(identifier: string, file: UploadedFile, duration: number, apiUrl: string) {
    if (!isMp3(file.buffer)) throw new BadRequestException('audio must contain a valid MP3 file');
    const existing = await this.findTrack(identifier);
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    const safeSlug = existing.slug.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'track';
    const storageKey = `${safeSlug}-${digest}.mp3`;
    await writeStableFile(join(process.cwd(), 'storage', 'audio'), storageKey, file.buffer);

    const track = await this.prisma.track.update({
      where: { id: existing.id },
      data: {
        storageKey,
        fileSizeBytes: BigInt(file.buffer.length),
        duration,
        codec: AudioCodec.MP3
      },
      include: trackRelations
    });
    return this.toAdminTrack(track, apiUrl);
  }

  /**
   * Alta o actualización de una pista, con su audio.
   *
   * Es la lógica que vivía en `scripts/import-manifest.ts`, traída aquí para
   * que exista **una sola puerta de entrada** al catálogo: antes había dos, y
   * la principal exigía que quien publicaba compartiera disco con el servidor.
   *
   * Idempotente por slug, como lo era el importador: reenviar la misma pista
   * actualiza en vez de duplicar.
   */
  async publishTrack(input: PublishTrackDto, audio: UploadedFile, cover?: UploadedFile) {
    if (!isMp3(audio.buffer)) throw new BadRequestException('audio must contain a valid MP3 file');

    // Direccionado por contenido: el mismo audio subido dos veces ocupa una
    // sola vez, y el objeto es inmutable, así que puede cachearse sin límite.
    const digest = createHash('sha256').update(audio.buffer).digest('hex');
    const storageKey = `${digest}.mp3`;

    // Compartir el archivo es intencionado, pero `storageKey` es único, así que
    // dos pistas distintas no pueden apuntar al mismo objeto. Sin esta
    // comprobación el conflicto salía como P2002 sin capturar —un 500 opaco— y
    // el cliente no tenía forma de saber que estaba subiendo un duplicado
    // exacto de algo que ya publicó con otro nombre.
    const mismoAudio = await this.prisma.track.findUnique({
      where: { storageKey },
      select: { slug: true, title: true }
    });
    if (mismoAudio && mismoAudio.slug !== input.slug) {
      throw new ConflictException(
        `This audio is already published as '${mismoAudio.slug}' (${mismoAudio.title}). ` +
        `Byte-for-byte duplicates cannot be published twice.`
      );
    }

    await writeStableFile(join(process.cwd(), 'storage', 'audio'), storageKey, audio.buffer);

    const coverUrl = cover ? (await this.uploadCover(cover)).coverUrl : null;

    const artist = await this.prisma.artist.upsert({
      where: { slug: input.artist.slug },
      create: {
        slug: input.artist.slug,
        name: input.artist.name,
        genres: input.artist.genres
      },
      // Los géneros no se pisan: pueden haberse curado a mano en la base y lo
      // que llega de fuera no siempre sabe más.
      update: { name: input.artist.name }
    });

    const genre = input.genre ?? artist.genres[0] ?? DEFAULT_GENRE;

    // El esquema exige álbum en toda pista. Sin él se crea un lanzamiento
    // SINGLE con el nombre de la canción, que es lo que representa de verdad
    // una pista suelta.
    const albumInput = input.album ?? {
      slug: `single-${input.slug}`,
      title: input.title,
      year: null
    };

    const album = await this.prisma.album.upsert({
      where: { slug: albumInput.slug },
      create: {
        slug: albumInput.slug,
        artistId: artist.id,
        title: albumInput.title,
        year: albumInput.year ?? 0,
        type: input.album ? 'ALBUM' : 'SINGLE',
        genre,
        coverUrl: coverUrl ?? DEFAULT_COVER
      },
      // Una publicación sin portada no debe degradar arte ya curado: coverUrl
      // solo se reemplaza cuando esta subida trae una nueva.
      update: {
        title: albumInput.title,
        ...(albumInput.year ? { year: albumInput.year } : {}),
        ...(coverUrl ? { coverUrl } : {})
      }
    });

    // La compuerta: lo que llega incompleto entra, pero no se publica. Así una
    // pista a medias nunca aparece rota en la app de nadie.
    //
    // El género NO entra aquí. Es tentador exigirlo —media biblioteca acaba en
    // "Sin clasificar"— pero ninguna de las fuentes de la cadena lo aporta de
    // forma fiable, así que exigirlo no mejora el dato: solo deja todo sin
    // publicar por algo que nadie puede rellenar. Se pide lo que sí se puede
    // conseguir; el género se cura aparte.
    //
    // Se mira `album.year` —el álbum ya guardado— y no `albumInput.year`, que
    // es solo lo que traía esta petición. El upsert de arriba conserva a
    // propósito el año existente cuando el envío no trae uno, así que preguntar
    // por el input dejaba en espera pistas cuyo disco sí tenía año: entraban a
    // un álbum completo y se quedaban fuera del catálogo por un dato que la
    // base ya conocía.
    const missing = [
      !input.album && 'álbum',
      !album.year && 'año'
    ].filter(Boolean) as string[];

    const track = await this.prisma.track.upsert({
      where: { slug: input.slug },
      create: {
        slug: input.slug,
        artistId: artist.id,
        albumId: album.id,
        title: input.title,
        duration: input.duration,
        genre,
        codec: AudioCodec.MP3,
        storageKey,
        fileSizeBytes: BigInt(audio.buffer.length),
        isPublished: missing.length === 0
      },
      update: {
        title: input.title,
        duration: input.duration,
        albumId: album.id,
        genre,
        storageKey,
        fileSizeBytes: BigInt(audio.buffer.length),
        // Una pista que estaba en espera por incompleta se publica en cuanto
        // llega completa: si no, quedaría esperando para siempre a un paso que
        // no existe. Al revés no: que este envío venga sin álbum no es motivo
        // para retirar del catálogo algo que ya estaba publicado.
        ...(missing.length === 0 ? { isPublished: true } : {})
      },
      include: trackRelations
    });

    return { ...this.toAdminTrack(track, ''), pending: missing };
  }

  /**
   * Corrige un álbum y saca de la espera lo que solo esperaba ese dato.
   *
   * El año es el único campo que retiene pistas fuera del catálogo y no había
   * forma de arreglarlo desde fuera: vive en Album, y `updateTrack` solo toca
   * la pista. Sin esto, una pista en espera por «falta año» se quedaba ahí para
   * siempre salvo que se volviera a subir su MP3 entero.
   *
   * Republicar aquí es lo coherente con `publishTrack`, que ya saca de la
   * espera lo que llega completo: el criterio de «publicable» debe ser el
   * mismo se llegue por donde se llegue.
   */
  async updateAlbum(id: string, input: UpdateAlbumDto, apiUrl: string) {
    const album = await this.prisma.album.findUnique({ where: { id } });
    if (!album) throw new NotFoundException('Album not found');

    const updated = await this.prisma.album.update({
      where: { id },
      data: { year: input.year, title: input.title, coverUrl: input.coverUrl }
    });

    // Solo se publica lo que estaba esperando: una pista despublicada a mano no
    // debe volver al catálogo porque alguien corrigiera el año de su disco.
    let published = 0;
    if (updated.year) {
      const result = await this.prisma.track.updateMany({
        where: { albumId: id, isPublished: false },
        data: { isPublished: true }
      });
      published = result.count;
    }

    return {
      id: updated.id,
      slug: updated.slug,
      title: updated.title,
      year: updated.year,
      coverUrl: absoluteUrl(apiUrl, updated.coverUrl),
      published
    };
  }

  async uploadCover(file: UploadedFile) {
    const extension = imageExtension(file.buffer);
    if (!extension) throw new BadRequestException('cover must contain a valid JPG, PNG or WebP image');
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    const filename = `${digest}.${extension}`;
    await writeStableFile(join(process.cwd(), 'storage', 'covers'), filename, file.buffer);
    return { coverUrl: `/media/covers/${filename}` };
  }
}
