import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Length, Min } from 'class-validator';

import { Optional, Trim } from '../common/validation';

export class CreateTvSessionDto {
  @ApiPropertyOptional({
    example: 'TV del salón',
    description: 'Cómo se llamará en la lista de dispositivos del teléfono.'
  })
  @Optional()
  @Trim()
  @IsString()
  @Length(1, 60)
  name?: string;
}

export class ClaimTvSessionDto {
  @ApiProperty({
    example: 'K7M2QP',
    description: 'El código que enseña el televisor. No distingue mayúsculas.'
  })
  @Trim()
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ReportNowPlayingDto {
  @ApiProperty({ format: 'uuid', description: 'La pista que está sonando.' })
  @Trim()
  @IsString()
  @Length(1, 128)
  trackId!: string;

  @ApiProperty({
    example: 42_500,
    description: 'Posición en milisegundos. El televisor la extrapola entre dos avisos.'
  })
  @IsInt()
  @Min(0)
  positionMs!: number;

  @ApiProperty({ description: 'Falso en pausa: la pantalla deja de avanzar la letra.' })
  @IsBoolean()
  isPlaying!: boolean;
}
