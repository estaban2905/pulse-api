import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/auth.decorators';
import { HealthDto } from './health.responses';

@ApiTags('Health')
@Controller('health')
@Public()
export class HealthController {
  @Get()
  @ApiOperation({
    operationId: 'getHealth',
    summary: 'Comprobar que el API responde',
    description: 'Responde sin tocar la base de datos: solo confirma que el proceso está vivo.'
  })
  @ApiOkResponse({ type: HealthDto })
  health(): HealthDto {
    return { status: 'ok', service: 'pulse-api', version: '0.1.0', at: new Date().toISOString() };
  }
}