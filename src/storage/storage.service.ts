import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { SecurityConfig } from '../config/security.config';

/**
 * Ventana de estabilidad de una URL firmada, en segundos.
 *
 * La firma se calcula desde el principio de la hora en curso y no desde el
 * instante exacto, así que todas las peticiones de una misma hora producen la
 * misma URL. Importa porque la clave de caché del navegador es la URL entera,
 * query string incluida: firmando con la hora exacta, cada carga del catálogo
 * inventaba una URL nueva y el archivo se volvía a bajar aunque estuviera ya
 * en la caché.
 */
const SIGNATURE_WINDOW_SECONDS = 60 * 60;

/** Prefijo con el que las portadas quedan guardadas en la base de datos. */
const COVERS_PREFIX = '/media/covers/';

function readVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}. Copia .env.example a .env y pon las credenciales de R2.`);
  }
  return value;
}

/**
 * Acceso al almacenamiento de objetos donde viven el audio y las portadas.
 *
 * Los archivos dejaron de estar en el disco del servidor por dos razones que
 * se refuerzan: el tráfico de audio pasaba entero por el proceso —y se pagaba
 * como salida de Render— y el disco ataba el servicio a una sola instancia.
 *
 * Son dos cubos y no uno porque el acceso público no se puede limitar a una
 * parte del contenido: abrir el de las portadas abriría también el audio.
 *
 * Habla el protocolo de S3, así que sirve igual contra R2, contra MinIO en
 * local o contra el propio S3 sin tocar nada más que las variables.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  readonly audioBucket: string;
  readonly coversBucket: string;
  /** Base pública de las portadas, ya sin la barra final. */
  private readonly coversPublicUrl: string;

  constructor(private readonly config: SecurityConfig) {
    const endpoint = readVar('S3_ENDPOINT');
    this.audioBucket = readVar('S3_BUCKET');
    this.coversBucket = readVar('S3_COVERS_BUCKET');
    this.coversPublicUrl = readVar('COVERS_PUBLIC_URL').replace(/\/$/, '');

    this.client = new S3Client({
      endpoint,
      // R2 no tiene regiones al estilo de AWS, pero la firma SigV4 exige una:
      // `auto` es la que espera Cloudflare.
      region: 'auto',
      credentials: {
        accessKeyId: readVar('S3_ACCESS_KEY'),
        secretAccessKey: readVar('S3_SECRET_KEY')
      },
      // El nombre del cubo va en la ruta y no en el subdominio. Con un endpoint
      // propio, el estilo de subdominio construiría un host que no existe.
      forcePathStyle: true
    });
  }

  /** Sube un objeto, sobrescribiendo si ya estaba. */
  async put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
    );
  }

  async putAudio(key: string, body: Buffer): Promise<void> {
    await this.put(this.audioBucket, key, body, 'audio/mpeg');
  }

  async putCover(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.put(this.coversBucket, key, body, contentType);
  }

  /**
   * URL temporal de descarga para una pista.
   *
   * Quien la valida es el almacenamiento, no este servidor: por eso el audio
   * puede viajar sin pasar por aquí y el cubo sigue siendo privado. El permiso
   * de este API se comprueba antes, al pedir el redirect.
   */
  async signedAudioUrl(key: string, now = Date.now()): Promise<string> {
    const seconds = Math.floor(now / 1000);
    const signingDate = new Date((seconds - (seconds % SIGNATURE_WINDOW_SECONDS)) * 1000);

    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.audioBucket, Key: key }), {
      expiresIn: this.config.mediaUrlTtlSeconds,
      signingDate
    });
  }

  /**
   * URL pública y estable de una portada.
   *
   * Sin firmar a propósito: los nombres son el hash del contenido, así que la
   * imagen es inmutable y el navegador puede quedársela. Una URL firmada
   * caducaría y la obligaría a bajarla otra vez sin que nada haya cambiado.
   */
  coverUrl(filename: string): string {
    return `${this.coversPublicUrl}/${filename}`;
  }

  /**
   * Traduce una ruta guardada en la base a su dirección real, o `null` si esa
   * ruta no es una portada.
   *
   * La base sigue guardando `/media/covers/<hash>.jpg` como antes: mover los
   * archivos no exigió tocar ni una fila. La traducción ocurre al construir la
   * respuesta, y así el cliente va directo al almacenamiento en vez de pasar
   * por la redirección de `MediaController`.
   */
  publicMediaUrl(path: string): string | null {
    if (!path.startsWith(COVERS_PREFIX)) return null;
    return this.coverUrl(path.slice(COVERS_PREFIX.length));
  }
}
