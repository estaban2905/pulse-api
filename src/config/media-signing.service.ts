import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { SecurityConfig } from './security.config';

/** Parámetros que acompañan a una URL firmada. */
export interface MediaSignature {
  /** Caducidad, en segundos desde la época. */
  exp: number;
  sig: string;
}

/**
 * Firma las URLs de audio.
 *
 * El streaming no se puede cerrar con un Bearer: la etiqueta `<audio src>` no
 * manda cabeceras, así que el permiso tiene que viajar dentro de la propia URL.
 * Una firma con caducidad hace justo eso —y sin consultar la base de datos al
 * servir, que importa cuando cada salto en la barra de progreso abre una
 * petición nueva con su cabecera `Range`.
 */
@Injectable()
export class MediaSigningService {
  constructor(private readonly config: SecurityConfig) {}

  private digest(trackId: string, exp: number): Buffer {
    // El identificador entra tal cual aparecerá en la URL: si alguien cambia el
    // que pide, la firma deja de cuadrar y no puede reutilizarla para otra pista.
    return createHmac('sha256', this.config.mediaSigningSecret).update(`${trackId}:${exp}`, 'utf8').digest();
  }

  /** Firma para una pista, válida durante el TTL configurado. */
  sign(trackId: string, now = Date.now()): MediaSignature {
    const exp = Math.floor(now / 1000) + this.config.mediaUrlTtlSeconds;
    return { exp, sig: this.digest(trackId, exp).toString('base64url') };
  }

  /** Query string ya montada, para pegar detrás de la URL de la pista. */
  signedQuery(trackId: string, version: number): string {
    const { exp, sig } = this.sign(trackId);
    return `v=${version}&exp=${exp}&sig=${sig}`;
  }

  /**
   * Comprueba una firma recibida.
   *
   * La caducidad se mira antes que el HMAC porque es lo barato, y el HMAC se
   * compara en tiempo constante para no filtrar cuánto acertó quien lo intente.
   */
  verify(trackId: string, exp: string | undefined, sig: string | undefined, now = Date.now()): boolean {
    if (!exp || !sig) return false;

    const expiresAt = Number(exp);
    if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return false;

    let supplied: Buffer;
    try {
      supplied = Buffer.from(sig, 'base64url');
    } catch {
      return false;
    }

    const expected = this.digest(trackId, expiresAt);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}
