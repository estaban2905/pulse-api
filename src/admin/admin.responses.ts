import { ApiProperty } from '@nestjs/swagger';

import { AudioCodec } from '../../generated/prisma/enums';

/** Esquemas que devuelve el API de mantenimiento del catálogo. */

export class AdminTrackDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'get-lucky' })
  slug!: string;

  @ApiProperty({ example: 'Get Lucky' })
  title!: string;

  @ApiProperty({ format: 'uuid' })
  artistId!: string;

  @ApiProperty({ example: 'Daft Punk' })
  artistName!: string;

  @ApiProperty({ format: 'uuid' })
  albumId!: string;

  @ApiProperty({ example: 'Random Access Memories' })
  albumTitle!: string;

  @ApiProperty({ example: 369, description: 'Duración en segundos.' })
  duration!: number;

  @ApiProperty({ example: 'Electronic' })
  genre!: string;

  @ApiProperty()
  explicit!: boolean;

  @ApiProperty({ enum: AudioCodec, enumName: 'AudioCodec' })
  codec!: AudioCodec;

  @ApiProperty({ description: 'Portada efectiva: la propia si existe, si no la del álbum.' })
  coverUrl!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Portada propia de la pista. `null` significa que hereda la del álbum.'
  })
  ownCoverUrl!: string | null;

  @ApiProperty()
  albumCoverUrl!: string;

  @ApiProperty()
  streamUrl!: string;

  @ApiProperty({ example: 8_412_160 })
  fileSizeBytes!: number;

  @ApiProperty()
  isPublished!: boolean;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class AdminAlbumDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'random-access-memories' })
  slug!: string;

  @ApiProperty({ example: 'Random Access Memories' })
  title!: string;

  @ApiProperty({ format: 'uuid' })
  artistId!: string;

  @ApiProperty({ example: 'Daft Punk' })
  artistName!: string;

  @ApiProperty({ example: 2013, description: '`0` marca un álbum sin año, que retiene sus pistas en espera.' })
  year!: number;

  @ApiProperty()
  coverUrl!: string;
}

export class AdminArtistDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'daft-punk' })
  slug!: string;

  @ApiProperty({ example: 'Daft Punk' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` cuando el artista no tiene retrato. A diferencia del catálogo ' +
      'público, aquí no se rellena con el placeholder: quien vaya a copiar la foto ' +
      'necesita distinguir un retrato real del relleno que llevan todos.'
  })
  photoUrl!: string | null;
}

export class AdminCatalogDto {
  @ApiProperty({ type: [AdminTrackDto], description: 'Todas las pistas, publicadas o no.' })
  tracks!: AdminTrackDto[];

  @ApiProperty({ type: [AdminAlbumDto], description: 'Álbumes válidos como destino de una pista.' })
  albums!: AdminAlbumDto[];

  @ApiProperty({ type: [AdminArtistDto], description: 'Los artistas, con su foto si la tienen.' })
  artists!: AdminArtistDto[];
}

export class PublishTrackResultDto extends AdminTrackDto {
  @ApiProperty({
    type: [String],
    example: ['año'],
    description:
      'Datos que faltan para publicar. Si no está vacío la pista queda en espera, fuera del catálogo público.'
  })
  pending!: string[];
}

export class UpdateAlbumResultDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'random-access-memories' })
  slug!: string;

  @ApiProperty({ example: 'Random Access Memories' })
  title!: string;

  @ApiProperty({ example: 2013 })
  year!: number;

  @ApiProperty()
  coverUrl!: string;

  @ApiProperty({
    example: 2,
    description: 'Pistas que estaban en espera por este álbum y han pasado a publicadas.'
  })
  published!: number;
}

export class CoverUploadResultDto {
  @ApiProperty({
    example: '/media/covers/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08.jpg',
    description: 'Ruta servida por este API. Sirve tal cual como `coverUrl` al editar una pista.'
  })
  coverUrl!: string;
}
