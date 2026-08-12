import { ApiProperty } from '@nestjs/swagger';

import { AudioCodec, ReleaseType } from '../../generated/prisma/enums';

/**
 * Esquemas del catálogo público.
 *
 * Son clases solo de documentación: describen lo que `CatalogService` ya
 * devuelve. `storageKey` no aparece por diseño: es estado interno del servidor.
 */

export class CatalogArtistDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'daft-punk' })
  slug!: string;

  @ApiProperty({ example: 'Daft Punk' })
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  bio!: string | null;

  @ApiProperty({ description: 'URL absoluta; cae en el placeholder si el artista no tiene foto.' })
  photoUrl!: string;

  @ApiProperty({ type: [String], example: ['Electronic', 'House'] })
  genres!: string[];
}

export class CatalogAlbumDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'random-access-memories' })
  slug!: string;

  @ApiProperty({ example: 'Random Access Memories' })
  title!: string;

  @ApiProperty({ format: 'uuid' })
  artistId!: string;

  @ApiProperty({ example: 2013 })
  year!: number;

  @ApiProperty({ enum: ReleaseType, enumName: 'ReleaseType' })
  type!: ReleaseType;

  @ApiProperty({ example: 'Electronic' })
  genre!: string;

  @ApiProperty({ description: 'URL absoluta de la portada.' })
  coverUrl!: string;

  @ApiProperty({ example: '#4B5563', description: 'Color de acento para la interfaz.' })
  accent!: string;
}

export class CatalogTrackDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'get-lucky' })
  slug!: string;

  @ApiProperty({ example: 'Get Lucky' })
  title!: string;

  @ApiProperty({ format: 'uuid' })
  artistId!: string;

  @ApiProperty({ format: 'uuid' })
  albumId!: string;

  @ApiProperty({ example: 369, description: 'Duración en segundos.' })
  duration!: number;

  @ApiProperty({ example: 'Electronic' })
  genre!: string;

  @ApiProperty()
  explicit!: boolean;

  @ApiProperty({ enum: AudioCodec, enumName: 'AudioCodec' })
  codec!: AudioCodec;

  @ApiProperty({ description: 'Portada propia de la pista o, si no tiene, la de su álbum.' })
  coverUrl!: string;

  @ApiProperty({
    description:
      'URL de reproducción. Lleva `?v=<updatedAt>` para que el cliente no reutilice el MP3 anterior cuando se reemplaza el audio.',
    example: 'http://localhost:4000/v1/tracks/9f86d0.../stream?v=1754923200000'
  })
  streamUrl!: string;
}

export class CatalogDto {
  @ApiProperty({ type: [CatalogArtistDto] })
  artists!: CatalogArtistDto[];

  @ApiProperty({ type: [CatalogAlbumDto] })
  albums!: CatalogAlbumDto[];

  @ApiProperty({ type: [CatalogTrackDto] })
  tracks!: CatalogTrackDto[];
}