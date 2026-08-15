import { ApiProperty } from '@nestjs/swagger';

export class LyricLineDto {
  @ApiProperty({
    example: 12.34,
    description: 'Segundos desde el principio de la pista. Siempre 0 cuando la letra no está sincronizada.'
  })
  time!: number;

  @ApiProperty({ example: 'Like the legend of the phoenix' })
  text!: string;
}

export class LyricsDto {
  @ApiProperty({
    enum: ['synced', 'plain', 'instrumental', 'missing'],
    description:
      '`synced` trae marcas de tiempo y permite karaoke; `plain` es solo texto; `instrumental` y `missing` llegan con `lines` vacío y son respuestas, no errores.'
  })
  status!: 'synced' | 'plain' | 'instrumental' | 'missing';

  @ApiProperty({ example: 'lrclib', description: 'Quién proporcionó la letra.' })
  source!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo se consultó al proveedor. Una letra encontrada no se vuelve a pedir.'
  })
  fetchedAt!: string;

  @ApiProperty({ type: [LyricLineDto], description: 'Ya ordenadas por tiempo.' })
  lines!: LyricLineDto[];
}
