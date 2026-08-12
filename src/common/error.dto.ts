import { ApiProperty } from '@nestjs/swagger';

/**
 * Forma de error que devuelve la API.
 *
 * `message` es una lista cuando falla la validación de un cuerpo: cada entrada
 * es una regla incumplida, para poder señalar el campo exacto en el cliente.
 */
export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['title must be longer than or equal to 1 characters']
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}