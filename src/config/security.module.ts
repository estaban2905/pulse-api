import { Global, Module } from '@nestjs/common';

import { MediaSigningService } from './media-signing.service';
import { SecurityConfig } from './security.config';

/**
 * Global porque los secretos los necesitan capas que no se conocen entre sí:
 * el módulo de auth para firmar sesiones, el guard global para verificarlas, y
 * el catálogo y el reproductor para las URLs de audio.
 */
@Global()
@Module({
  providers: [SecurityConfig, MediaSigningService],
  exports: [SecurityConfig, MediaSigningService]
})
export class SecurityModule {}
