import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: 'pulse-api' })
  service!: string;

  @ApiProperty({ example: '0.1.0' })
  version!: string;

  @ApiProperty({ format: 'date-time' })
  at!: string;
}
