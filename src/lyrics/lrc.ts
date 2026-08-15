/**
 * Lectura del formato LRC.
 *
 * Vivía en el navegador, donde solo servía a la web. Aquí sirve a los dos
 * clientes y, sobre todo, se ejecuta una vez por canción en lugar de una vez
 * por dispositivo que la abre.
 */

export interface LyricLine {
  /** Segundos desde el principio de la pista. Cero en las letras sin sincronizar. */
  time: number;
  text: string;
}

/** `[mm:ss.xx] texto` — el formato de marca que devuelve LRCLIB. */
const LRC_LINE = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s?(.*)$/;

/** Marcador de pasaje sin voz. Se conserva para que el karaoke no salte de golpe. */
const INSTRUMENTAL_MARK = '♪';

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const raw of lrc.split('\n')) {
    const match = LRC_LINE.exec(raw.trim());
    if (!match) continue;

    const [, minutes, seconds, fraction, text] = match;
    // Dos dígitos son centésimas y tres, milésimas.
    const fractionalSeconds = fraction ? Number(fraction) / (fraction.length === 3 ? 1_000 : 100) : 0;
    const time = Number(minutes) * 60 + Number(seconds) + fractionalSeconds;
    if (!Number.isFinite(time)) continue;

    lines.push({ time, text: text.trim() || INSTRUMENTAL_MARK });
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Convierte texto plano en líneas.
 *
 * Todas quedan en el segundo cero: sin marcas no hay línea activa que resaltar,
 * y el cliente lo distingue por el `status`, no por los tiempos.
 */
export function parsePlain(plain: string): LyricLine[] {
  return plain
    .split('\n')
    .map((text) => text.trim())
    // Un blanco solo se conserva si separa dos estrofas; los del final se van.
    .filter((text, index, all) => text || all[index - 1])
    .map((text) => ({ time: 0, text: text || INSTRUMENTAL_MARK }));
}
