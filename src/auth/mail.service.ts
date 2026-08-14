import { Injectable, Logger } from '@nestjs/common';

export interface MailMessage {
  to: string;
  subject: string;
  /** Cuerpo en texto plano. El enlace va dentro, sin maquetar. */
  body: string;
}

/**
 * Envío de correo.
 *
 * Todavía no hay proveedor conectado: sin uno, la única alternativa honesta es
 * dejar el mensaje en el log del servidor, para que en desarrollo se pueda
 * copiar el enlace y seguir el flujo entero. Fingir un envío correcto sería
 * peor, porque el usuario esperaría un correo que no va a llegar.
 *
 * Conectar un proveedor real es sustituir `deliver`: el resto del código ya
 * habla con esta interfaz y no cambia.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** ¿Hay forma de entregar correo de verdad? */
  get isConfigured(): boolean {
    return Boolean(process.env.SMTP_URL);
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        [
          'SMTP_URL no está configurado: el correo no se ha enviado.',
          `Para: ${message.to}`,
          `Asunto: ${message.subject}`,
          message.body
        ].join('\n')
      );
      return;
    }

    await this.deliver(message);
  }

  /**
   * Entrega real. Pendiente de proveedor.
   *
   * Se deja explícito en lugar de silencioso para que, si alguien configura
   * `SMTP_URL` creyendo que basta, el fallo aparezca aquí y no en forma de
   * usuarios esperando un correo que nadie mandó.
   */
  private async deliver(message: MailMessage): Promise<void> {
    this.logger.error(`SMTP_URL está configurado pero no hay cliente de correo implementado. Destino: ${message.to}`);
    throw new Error('El envío de correo no está implementado todavía');
  }
}
