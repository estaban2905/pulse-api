/**
 * Identificadores públicos del catálogo.
 *
 * Un mismo objeto se puede nombrar de tres formas según la antigüedad del
 * cliente: su UUID, su slug canónico (`jigsaw`) o el identificador del primer
 * catálogo estático (`tr-jigsaw`). Los tres tienen que seguir funcionando, y
 * ninguna consulta puede mandar un slug a una columna UUID: PostgreSQL rechaza
 * el valor antes de que Prisma pueda devolver null.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LEGACY_PREFIX = {
  track: 'tr-',
  album: 'al-',
  artist: 'ar-'
} as const;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * Devuelve los slugs que hay que probar, en orden de preferencia.
 *
 * El slug exacto va primero para que una futura pista llamada de verdad
 * `tr-algo` no quede secuestrada por la regla de compatibilidad.
 */
export function slugCandidates(identifier: string, legacyPrefix: string): string[] {
  const candidates = [identifier];
  if (identifier.startsWith(legacyPrefix)) {
    const stripped = identifier.slice(legacyPrefix.length);
    if (stripped) candidates.push(stripped);
  }
  return candidates;
}
