import { Injectable } from '@nestjs/common';

/** Longitud mínima de un secreto de firma, en caracteres. */
const MIN_SECRET_LENGTH = 32;

/**
 * Vida del access token. Corta a propósito: es el único credencial que viaja en
 * cada petición y no se puede revocar una vez emitido, así que su ventana de
 * daño se acota con el reloj, no con la base de datos.
 */
const ACCESS_TOKEN_TTL = '15m';

/** Vida del refresh token. Sí es revocable, así que puede durar mucho más. */
const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * Vida de una URL de audio firmada, en segundos.
 *
 * Un día: de sobra para la sesión más larga —la web rehidrata el catálogo en
 * cada arranque, así que las firmas se renuevan solas— y lo bastante corto
 * para que un enlace copiado y pegado en otro sitio deje de servir pronto.
 */
const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

function readSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}. Copia .env.example a .env y genera un valor aleatorio.`);
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} debe tener al menos ${MIN_SECRET_LENGTH} caracteres (tiene ${value.length}).`);
  }
  return value;
}

/**
 * Secretos y parámetros de sesión, validados al construir el módulo.
 *
 * Falla al arrancar y no en la primera petición: un servidor que levanta con un
 * secreto vacío firma tokens que cualquiera puede reproducir, y el síntoma
 * aparece mucho después del despliegue que lo causó.
 */
@Injectable()
export class SecurityConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly mediaSigningSecret: string;
  readonly accessTtl = ACCESS_TOKEN_TTL;
  readonly refreshTtlDays = REFRESH_TOKEN_TTL_DAYS;
  readonly mediaUrlTtlSeconds = MEDIA_URL_TTL_SECONDS;
  readonly isProduction: boolean;
  readonly cookieSameSite: 'lax' | 'none';
  readonly cookieSecure: boolean;
  readonly cookieDomain?: string;

  constructor() {
    this.accessSecret = readSecret('JWT_ACCESS_SECRET');
    this.refreshSecret = readSecret('JWT_REFRESH_SECRET');
    this.mediaSigningSecret = readSecret('MEDIA_SIGNING_SECRET');

    // Con un único secreto para ambos, un access token robado serviría como
    // refresh: la firma cuadraría y la rotación dejaría de significar nada.
    if (this.accessSecret === this.refreshSecret) {
      throw new Error('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos.');
    }

    this.isProduction = process.env.NODE_ENV === 'production';

    // `lax` sirve mientras la web y el API compartan dominio de nivel superior
    // (`pulse.app` y `api.pulse.app`, o dos puertos de localhost). Alojados en
    // proveedores distintos la petición es cross-site y el navegador descarta
    // la cookie salvo que se pida `none`, que a su vez obliga a HTTPS.
    this.cookieSameSite = process.env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax';
    this.cookieSecure = this.cookieSameSite === 'none' || this.isProduction;
    this.cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  }

  /** Momento de caducidad de un refresh token emitido ahora. */
  refreshExpiryFrom(now: Date): Date {
    return new Date(now.getTime() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}
