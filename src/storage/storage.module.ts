import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/**
 * Global por el mismo motivo que `SecurityModule`: el reproductor, el catálogo
 * y el admin necesitan el almacenamiento sin conocerse entre ellos.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService]
})
export class StorageModule {}
