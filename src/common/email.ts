/**
 * Forma canónica de una dirección de correo.
 *
 * Dos direcciones distintas pueden ser el mismo buzón: Gmail ignora los puntos
 * de la parte local, y casi todos los proveedores tratan `algo+etiqueta` como
 * `algo`. Sin normalizar, `max.poblete2905@gmail.com` y
 * `max.poblete.2905@gmail.com` se registran como cuentas separadas aunque el
 * correo de recuperación de ambas caiga en la misma bandeja.
 *
 * Esta clave es solo para comparar y para el índice único. La dirección que
 * escribió el usuario se guarda aparte y es la que se muestra y a la que se
 * escribe: nadie quiere ver su correo reescrito.
 */

/** Proveedores que ignoran los puntos de la parte local. */
const DOTLESS_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Proveedores donde `+etiqueta` es una subdirección del mismo buzón.
 *
 * La lista es explícita a propósito. El signo `+` es legal en un nombre de
 * usuario, así que recortarlo en un dominio cualquiera podría fundir dos
 * cuentas que de verdad son de personas distintas.
 */
const PLUS_ALIAS_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com'
]);

export function canonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // googlemail.com es un alias histórico de gmail.com: mismo buzón.
  const canonicalDomain = domain === 'googlemail.com' ? 'gmail.com' : domain;

  if (PLUS_ALIAS_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
  }

  if (DOTLESS_DOMAINS.has(domain)) {
    local = local.replaceAll('.', '');
  }

  // Una parte local vacía tras recortar (`+etiqueta@gmail.com`) no es una
  // dirección real; se devuelve lo normalizado sin inventar nada.
  return local ? `${local}@${canonicalDomain}` : trimmed;
}
