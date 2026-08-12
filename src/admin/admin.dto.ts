import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type as TransformType } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested
} from 'class-validator';

import {
  AtLeastOneField,
  IsCoverUrl,
  IsRecordingYear,
  NullableOptional,
  Optional,
  ToNumber,
  Trim
} from '../common/validation';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MESSAGE = 'must be lowercase words joined by single hyphens';

const MAX_DURATION_SECONDS = 86_400;

/** Segundos de audio: llega como texto en los multipart y como número en JSON. */
const DurationSeconds = () =>
  Transform(({ value }) => {
    const seconds = typeof value === 'string' ? Number(value.trim()) : value;
    // Solo se redondea lo que ya es un número válido: un 0 tiene que llegar
    // entero a los validadores para que lo rechacen en vez de subir a 1.
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return seconds;
    return Math.max(1, Math.round(seconds));
  });

// ---------------------------------------------------------------------------
// PATCH /admin/tracks/{identifier}
// ---------------------------------------------------------------------------

@AtLeastOneField(['title', 'genre', 'explicit', 'albumId', 'isPublished', 'coverUrl'])
export class UpdateTrackDto {
  @ApiPropertyOptional({ maxLength: 120, example: 'Jigsaw Falling Into Place' })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional({ maxLength: 80, example: 'Alternative rock' })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 80)
  genre?: string;

  @ApiPropertyOptional({ example: false })
  @Optional()
  @IsBoolean()
  explicit?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Mover la pista a otro álbum. El artista pasa a ser el del álbum destino.'
  })
  @Optional()
  @Trim()
  @IsUUID()
  albumId?: string;

  @ApiPropertyOptional({ description: 'Publica o retira la pista del catálogo público.' })
  @Optional()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 2048,
    example: '/media/covers/9f86d0….jpg',
    description: 'URL HTTP(S) o ruta /media/covers/. `null` borra la portada propia y hereda la del álbum.'
  })
  @NullableOptional()
  @Trim()
  @IsCoverUrl()
  coverUrl?: string | null;
}

// ---------------------------------------------------------------------------
// PATCH /admin/albums/{id}
// ---------------------------------------------------------------------------

@AtLeastOneField(['year', 'title', 'coverUrl'])
export class UpdateAlbumDto {
  @ApiPropertyOptional({
    minimum: 1900,
    maximum: 2100,
    example: 2013,
    description: 'Corregirlo publica las pistas del álbum que solo esperaban este dato.'
  })
  @Optional()
  @ToNumber()
  // El margen es más holgado que el de una publicación nueva a propósito: un
  // reeditado puede anunciarse antes de salir, y rechazarlo obligaría a mentir.
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ maxLength: 200, example: 'Random Access Memories' })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 200)
  title?: string;

  @ApiPropertyOptional({
    maxLength: 2048,
    example: '/media/covers/9f86d0….jpg',
    description:
      'Portada del disco. Útil para los recopilatorios que no tienen carátula propia: ' +
      'se les puede poner la foto del artista.'
  })
  // No admite `null`, a diferencia de la de una pista: en el esquema la portada
  // del álbum es obligatoria, así que no hay nada que heredar por debajo. Para
  // «quitarla» se manda el placeholder, que es lo que ya usa una publicación
  // que llega sin carátula.
  @Optional()
  @Trim()
  @IsCoverUrl()
  coverUrl?: string;
}

// ---------------------------------------------------------------------------
// POST /admin/tracks — campo `data` del multipart
// ---------------------------------------------------------------------------

export class PublishArtistDto {
  @ApiProperty({ maxLength: 160, example: 'daft-punk', pattern: SLUG_PATTERN.source })
  @Trim()
  @IsString()
  @Length(1, 160)
  @Matches(SLUG_PATTERN, { message: `slug ${SLUG_MESSAGE}` })
  slug!: string;

  @ApiProperty({ maxLength: 200, example: 'Daft Punk' })
  @Trim()
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    default: [],
    maxItems: 8,
    example: ['Electronic', 'House'],
    description: 'Solo se usan al crear el artista; no pisan géneros ya curados.'
  })
  @Transform(({ value }) => {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) return value;
    // Se recorta en vez de rechazar: quien publica no debería fallar entero
    // por traer una lista de géneros larga de más.
    return value.slice(0, 8).map((genre) => (typeof genre === 'string' ? genre.trim() : genre));
  })
  @IsArray()
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  // El valor por defecto no es cosmético: `@Transform` no se ejecuta sobre una
  // clave que no viene en la entrada, así que sin él omitir `genres` daría un
  // 400 en vez de la lista vacía que siempre significó.
  genres: string[] = [];
}

export class PublishAlbumDto {
  @ApiProperty({ maxLength: 160, example: 'random-access-memories', pattern: SLUG_PATTERN.source })
  @Trim()
  @IsString()
  @Length(1, 160)
  @Matches(SLUG_PATTERN, { message: `slug ${SLUG_MESSAGE}` })
  slug!: string;

  @ApiProperty({ maxLength: 200, example: 'Random Access Memories' })
  @Trim()
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    default: null,
    example: 2013,
    description: 'Sin año la pista entra en espera en vez de publicarse.'
  })
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' ? Number(value.trim()) : value;
  })
  @NullableOptional()
  @IsRecordingYear()
  year: number | null = null;
}

export class PublishTrackDto {
  @ApiProperty({ maxLength: 160, example: 'get-lucky', pattern: SLUG_PATTERN.source })
  @Trim()
  @IsString()
  @Length(1, 160)
  @Matches(SLUG_PATTERN, { message: `slug ${SLUG_MESSAGE}` })
  slug!: string;

  @ApiProperty({ maxLength: 200, example: 'Get Lucky' })
  @Trim()
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_DURATION_SECONDS, example: 369 })
  @DurationSeconds()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_SECONDS)
  duration!: number;

  @ApiProperty({ type: PublishArtistDto })
  @IsObject()
  @ValidateNested()
  @TransformType(() => PublishArtistDto)
  artist!: PublishArtistDto;

  @ApiPropertyOptional({
    type: PublishAlbumDto,
    nullable: true,
    default: null,
    description: 'Sin álbum se crea un SINGLE con el nombre de la pista y queda en espera.'
  })
  @NullableOptional()
  @IsObject()
  @ValidateNested()
  @TransformType(() => PublishAlbumDto)
  album: PublishAlbumDto | null = null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    default: null,
    maxLength: 80,
    example: 'Electronic',
    description: 'Si falta se hereda del artista, y en último término «Sin clasificar».'
  })
  @NullableOptional()
  @Trim()
  @IsString()
  @Length(1, 80)
  genre: string | null = null;
}

// ---------------------------------------------------------------------------
// POST /admin/tracks/{identifier}/audio — campos del multipart
// ---------------------------------------------------------------------------

export class ReplaceAudioFieldsDto {
  @ApiProperty({ minimum: 1, maximum: MAX_DURATION_SECONDS, example: 369 })
  @DurationSeconds()
  @IsInt()
  @Min(1)
  @Max(MAX_DURATION_SECONDS)
  duration!: number;
}

// ---------------------------------------------------------------------------
// Formularios multipart: existen solo para que Swagger dibuje el selector de
// archivo. Fastify lee el cuerpo como stream, así que no se validan aquí.
// ---------------------------------------------------------------------------

export class PublishTrackFormDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'MP3, máximo 60 MB.' })
  audio!: unknown;

  @ApiProperty({
    type: 'string',
    description: 'PublishTrackDto serializado como JSON.',
    example: '{"slug":"get-lucky","title":"Get Lucky","duration":369,"artist":{"slug":"daft-punk","name":"Daft Punk","genres":["Electronic"]},"album":{"slug":"random-access-memories","title":"Random Access Memories","year":2013},"genre":"Electronic"}'
  })
  data!: string;

  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'JPG, PNG o WebP, máximo 5 MB.' })
  cover?: unknown;
}

export class ReplaceAudioFormDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'MP3, máximo 60 MB.' })
  audio!: unknown;

  @ApiProperty({ type: 'number', example: 369, description: 'Duración del nuevo audio, en segundos.' })
  duration!: number;
}

export class UploadCoverFormDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'JPG, PNG o WebP, máximo 5 MB.' })
  cover!: unknown;
}

/**
 * Lee el campo `data` de un multipart.
 *
 * Fastify puede entregarlo ya parseado o todavía como texto, así que se
 * aceptan ambos para que quien publica no tenga que adivinar cuál espera.
 */
export function parseJsonField(value: unknown, field: string): unknown {
  if (value === undefined) throw new BadRequestException(`${field} is required`);
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException(`${field} must be valid JSON`);
  }
}