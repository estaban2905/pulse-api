import { ApiProperty } from '@nestjs/swagger';

export class TvPairingDto {
  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ example: 'K7M2QP', description: 'Lo que se enseña en pantalla, dentro del QR.' })
  code!: string;

  @ApiProperty({
    description: 'Token propio de la pantalla. Se guarda en el televisor y no caduca al emparejar.'
  })
  token!: string;

  @ApiProperty({ format: 'date-time', description: 'Cuándo deja de servir el código.' })
  expiresAt!: string;
}

export class TvScreenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'TV del salón' })
  name!: string;
}

export class NowPlayingDto {
  @ApiProperty({ format: 'uuid' })
  trackId!: string;

  @ApiProperty({ example: 42_500 })
  positionMs!: number;

  @ApiProperty()
  isPlaying!: boolean;

  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo lo informó el teléfono. La pantalla extrapola desde aquí.'
  })
  reportedAt!: string;
}

export class NowPlayingStateDto {
  @ApiProperty({ description: 'Falso mientras nadie haya reclamado el código.' })
  paired!: boolean;

  @ApiProperty({
    type: NowPlayingDto,
    nullable: true,
    description: 'Nulo si no está emparejada, o si la cuenta no está reproduciendo nada.'
  })
  nowPlaying!: NowPlayingDto | null;
}
