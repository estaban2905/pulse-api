import { Module } from '@nestjs/common';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// El guard propio desapareció: autenticar y autorizar son ahora responsabilidad
// de los guards globales, y este módulo solo declara qué rol hace falta.
@Module({
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
