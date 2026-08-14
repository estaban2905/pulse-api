import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';

import { AtLeastOneField, IsCoverUrl, NullableOptional, Optional, Trim } from '../common/validation';

const QUALITIES = ['low', 'normal', 'high', 'max'] as const;

/**
 * Cambios sobre los datos de la cuenta.
 *
 * El correo no está: es la identidad con la que se inicia sesión, y cambiarlo
 * sin verificar que el nuevo buzón existe deja a la cuenta sin forma de
 * recuperarse. Cuando haya verificación por correo tendrá su propio flujo.
 */
@AtLeastOneField(['displayName', 'avatarUrl'])
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ana' })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 60)
  displayName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '`null` quita el avatar.' })
  @NullableOptional()
  @IsCoverUrl()
  avatarUrl?: string | null;
}

export class LogPlayDto {
  @ApiProperty({ example: 'get-lucky', description: 'UUID de la pista, su slug, o un identificador `tr-*`.' })
  @Trim()
  @IsString()
  @Length(1, 128)
  trackId!: string;

  @ApiPropertyOptional({ example: 42, description: 'Segundos reproducidos.' })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  progress?: number;

  @ApiPropertyOptional({ description: 'Cierto si la pista llegó al final.' })
  @Optional()
  @IsBoolean()
  completed?: boolean;
}

@AtLeastOneField([
  'theme',
  'language',
  'streamQuality',
  'downloadQuality',
  'autoplay',
  'crossfade',
  'normalize',
  'privateSession',
  'favouriteGenres'
])
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: ['dark', 'light'] })
  @Optional()
  @IsIn(['dark', 'light'])
  theme?: string;

  @ApiPropertyOptional({ enum: ['es', 'en'] })
  @Optional()
  @IsIn(['es', 'en'])
  language?: string;

  @ApiPropertyOptional({ enum: QUALITIES })
  @Optional()
  @IsIn(QUALITIES)
  streamQuality?: string;

  @ApiPropertyOptional({ enum: QUALITIES })
  @Optional()
  @IsIn(QUALITIES)
  downloadQuality?: string;

  @ApiPropertyOptional()
  @Optional()
  @IsBoolean()
  autoplay?: boolean;

  @ApiPropertyOptional({ example: 6, description: 'Segundos de fundido entre pistas.' })
  @Optional()
  @IsInt()
  @Min(0)
  @Max(12)
  crossfade?: number;

  @ApiPropertyOptional()
  @Optional()
  @IsBoolean()
  normalize?: boolean;

  @ApiPropertyOptional({ description: 'Con la sesión privada activa el cliente deja de registrar reproducciones.' })
  @Optional()
  @IsBoolean()
  privateSession?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Sustituye la lista entera. Nombres de género tal y como los publica el catálogo.'
  })
  @Optional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  @ArrayMaxSize(30)
  favouriteGenres?: string[];
}

export class CreatePlaylistDto {
  @ApiProperty({ example: 'Para correr' })
  @Trim()
  @IsString()
  @Length(1, 120)
  title!: string;

  @ApiPropertyOptional({ example: 'Lo que suena cuando salgo temprano.' })
  @Optional()
  @Trim()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ description: 'URL absoluta o ruta `/media/covers/...`.' })
  @Optional()
  @IsCoverUrl()
  coverUrl?: string;

  @ApiPropertyOptional({ type: [String], description: 'En el orden en que deben quedar.' })
  @Optional()
  @IsArray()
  @IsString({ each: true })
  trackIds?: string[];
}

/**
 * Cambios sobre una playlist.
 *
 * `trackIds` es la lista completa y definitiva, no un añadido: el cliente ya
 * sabe en qué orden queda todo después de reordenar, y mandarlo entero evita
 * tener que reconciliar posiciones en el servidor.
 */
@AtLeastOneField(['title', 'description', 'coverUrl', 'isPublic', 'trackIds'])
export class UpdatePlaylistDto {
  @ApiPropertyOptional({ example: 'Para correr al amanecer' })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @NullableOptional()
  @Trim()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '`null` quita la portada.' })
  @NullableOptional()
  @IsCoverUrl()
  coverUrl?: string | null;

  @ApiPropertyOptional()
  @Optional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Sustituye la lista entera, en este orden.' })
  @Optional()
  @IsArray()
  @IsString({ each: true })
  trackIds?: string[];
}
