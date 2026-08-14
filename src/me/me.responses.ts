import { ApiProperty } from '@nestjs/swagger';

/** Esquemas de la biblioteca personal. */

export class HistoryEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  trackId!: string;

  @ApiProperty({ format: 'date-time' })
  playedAt!: string;

  @ApiProperty({ example: 42, description: 'Segundos reproducidos.' })
  progress!: number;

  @ApiProperty()
  completed!: boolean;
}

export class PreferencesDto {
  @ApiProperty({ example: 'dark' })
  theme!: string;

  @ApiProperty({ example: 'es' })
  language!: string;

  @ApiProperty({ example: 'high' })
  streamQuality!: string;

  @ApiProperty({ example: 'high' })
  downloadQuality!: string;

  @ApiProperty()
  autoplay!: boolean;

  @ApiProperty({ example: 0 })
  crossfade!: number;

  @ApiProperty()
  normalize!: boolean;

  @ApiProperty()
  privateSession!: boolean;

  @ApiProperty({ type: [String], example: ['Rock alternativo', 'Psicodelia'] })
  favouriteGenres!: string[];
}

export class LibraryDto {
  @ApiProperty({ type: [String], description: 'UUIDs de las pistas marcadas, de la más reciente a la más antigua.' })
  favourites!: string[];

  @ApiProperty({ type: [String], description: 'UUIDs de los álbumes guardados.' })
  savedAlbums!: string[];

  @ApiProperty({ type: [String], description: 'UUIDs de los artistas seguidos.' })
  followedArtists!: string[];

  @ApiProperty({ type: [HistoryEntryDto], description: 'Las 100 reproducciones más recientes.' })
  history!: HistoryEntryDto[];

  @ApiProperty({
    type: PreferencesDto,
    nullable: true,
    description: '`null` si la cuenta todavía no tiene preferencias guardadas.'
  })
  preferences!: PreferencesDto | null;
}

export class PlaylistDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Para correr' })
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true })
  coverUrl!: string | null;

  @ApiProperty()
  isPublic!: boolean;

  @ApiProperty()
  collaborative!: boolean;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ type: [String], description: 'UUIDs de las pistas, ya en orden.' })
  trackIds!: string[];
}

export class FavouriteResultDto {
  @ApiProperty({ format: 'uuid', description: 'UUID canónico, sea cual sea el identificador que se mandó.' })
  trackId!: string;
}

export class AlbumSaveResultDto {
  @ApiProperty({ format: 'uuid' })
  albumId!: string;
}

export class ArtistFollowResultDto {
  @ApiProperty({ format: 'uuid' })
  artistId!: string;
}
