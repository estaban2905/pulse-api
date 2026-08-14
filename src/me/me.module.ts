import { Module } from '@nestjs/common';

import { MeController } from './me.controller';
import { MeService } from './me.service';

// Sin guards propios: la autenticación global ya exige sesión, y el aislamiento
// entre cuentas lo garantiza el `userId` del token en cada consulta.
@Module({
  controllers: [MeController],
  providers: [MeService]
})
export class MeModule {}
