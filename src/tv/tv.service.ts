import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Pantallas de televisor emparejadas con una cuenta.
 *
 * Google Cast no llega a Samsung ni a LG, así que en esos televisores la app no
 * puede *recibir* una canción: hay que dársela. Esto es ese canal, y no depende
 * de ningún fabricante — sirve para una app de Tizen, una de webOS o el propio
 * navegador del televisor.
 */
@Injectable()
export class TvService {
  /**
   * Cuánto vive un código sin reclamar.
   *
   * Corto a propósito: mientras esté vivo, cualquiera que lo vea en la pantalla
   * puede vincular ese televisor a **su** cuenta. Dos minutos bastan para
   * escanear un QR y son pocos para aprovecharlo desde la calle.
   */
  private static readonly CODE_TTL_MS = 2 * 60 * 1000;

  /**
   * Alfabeto del código, sin `0`, `O`, `1`, `I` ni `L`.
   *
   * El QR es el camino normal, pero si la cámara falla hay que poder teclearlo
   * mirando la pantalla desde el sofá, y esos cinco caracteres se confunden
   * entre sí a tres metros.
   */
  private static readonly ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  private static readonly CODE_LENGTH = 6;

  constructor(private readonly prisma: PrismaService) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private static newCode(): string {
    let code = '';
    for (let i = 0; i < TvService.CODE_LENGTH; i += 1) {
      // `randomInt` y no `Math.random()`: este código es, durante dos minutos,
      // lo único que hace falta para vincularse a una cuenta ajena.
      code += TvService.ALPHABET[randomInt(TvService.ALPHABET.length)];
    }
    return code;
  }

  /**
   * Abre una pantalla nueva y devuelve su código.
   *
   * El televisor no se identifica con nada: aún no es de nadie. Se lleva un
   * token propio para poder preguntar por su estado sin volver a pedir código.
   */
  async createSession(name?: string) {
    const token = randomBytes(32).toString('base64url');

    // Un choque de código es improbable pero no imposible, y el índice único lo
    // convertiría en un error 500 delante del usuario. Reintentar es barato.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = TvService.newCode();
      try {
        const session = await this.prisma.tvSession.create({
          data: {
            code,
            codeExpiry: new Date(Date.now() + TvService.CODE_TTL_MS),
            tokenHash: TvService.hash(token),
            name: name?.trim() || 'Televisor'
          },
          select: { id: true, code: true, codeExpiry: true }
        });

        return {
          sessionId: session.id,
          code: session.code!,
          token,
          expiresAt: session.codeExpiry!.toISOString()
        };
      } catch {
        // Código repetido: se prueba con otro.
      }
    }

    throw new Error('No se pudo generar un código de emparejamiento');
  }

  /** Resuelve el televisor a partir de su token, o rechaza. */
  private async sessionFromToken(token: string) {
    const session = await this.prisma.tvSession.findUnique({
      where: { tokenHash: TvService.hash(token) },
      select: { id: true, userId: true, name: true }
    });
    if (!session) throw new UnauthorizedException('Esta pantalla ya no está autorizada');
    return session;
  }

  /**
   * Lo que el televisor pregunta en bucle.
   *
   * Devuelve tres cosas distintas según el momento: que siga esperando, que ya
   * está emparejado pero sin música, o qué suena. Un solo endpoint para los tres
   * estados evita que la pantalla tenga que orquestar varias llamadas.
   */
  async poll(token: string) {
    const session = await this.sessionFromToken(token);

    // Sirve de latido: es lo que permite distinguir una pantalla encendida de
    // una que se apagó hace un mes.
    await this.prisma.tvSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    });

    if (!session.userId) return { paired: false as const, nowPlaying: null };

    const playing = await this.prisma.nowPlaying.findUnique({
      where: { userId: session.userId },
      select: { trackId: true, positionMs: true, isPlaying: true, updatedAt: true }
    });

    if (!playing) return { paired: true as const, nowPlaying: null };

    return {
      paired: true as const,
      nowPlaying: {
        trackId: playing.trackId,
        positionMs: playing.positionMs,
        isPlaying: playing.isPlaying,
        // Con esto la pantalla puede calcular dónde va la canción entre dos
        // avisos, en lugar de congelarse hasta el siguiente.
        reportedAt: playing.updatedAt.toISOString()
      }
    };
  }

  /**
   * El teléfono reclama la pantalla.
   *
   * El código se borra al reclamarlo, no se marca como usado: lo que no está no
   * se puede reutilizar, y así no depende de que alguna consulta futura se
   * acuerde de filtrar por «usado».
   */
  async claim(userId: string, rawCode: string) {
    const code = rawCode.trim().toUpperCase();

    const session = await this.prisma.tvSession.findUnique({
      where: { code },
      select: { id: true, codeExpiry: true, name: true }
    });

    if (!session || !session.codeExpiry || session.codeExpiry.getTime() < Date.now()) {
      throw new NotFoundException('Ese código no es válido o ya caducó');
    }

    const claimed = await this.prisma.tvSession.update({
      where: { id: session.id },
      data: { userId, code: null, codeExpiry: null },
      select: { id: true, name: true }
    });

    return { id: claimed.id, name: claimed.name };
  }

  /** Las pantallas de esta cuenta, para la lista de dispositivos. */
  async listForUser(userId: string) {
    const sessions = await this.prisma.tvSession.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, name: true, lastSeenAt: true }
    });

    return sessions.map((session) => ({
      id: session.id,
      name: session.name,
      lastSeenAt: session.lastSeenAt.toISOString(),
      // Un minuto sin dar señales y se considera apagada: la pantalla pregunta
      // cada pocos segundos, así que un hueco así solo pasa si se cerró.
      online: Date.now() - session.lastSeenAt.getTime() < 60_000
    }));
  }

  async unlink(userId: string, sessionId: string): Promise<void> {
    await this.prisma.tvSession.deleteMany({ where: { id: sessionId, userId } });
  }

  /** El teléfono informa de qué suena. Una fila por cuenta, se sobrescribe. */
  async report(userId: string, trackId: string, positionMs: number, isPlaying: boolean) {
    const data = { trackId, positionMs: Math.max(0, Math.round(positionMs)), isPlaying };
    await this.prisma.nowPlaying.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
  }
}
