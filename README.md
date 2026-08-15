# Pulse API

API común para Pulse Web y Pulse Mobile. NestJS 11, Fastify 5, Prisma 7 y
PostgreSQL. Sirve el catálogo, las sesiones de usuario, la biblioteca personal,
el streaming de audio y un mantenedor protegido para administrar canciones.

## Dónde vive cada cosa

Tres proveedores, y ninguno hace el trabajo de otro:

| Pieza | Dónde | Por qué ahí |
|---|---|---|
| El proceso | **Render** — servicio web, plan Starter | Es lo único que hace falta pagar: un proceso escuchando |
| Catálogo, usuarios, playlists | **Neon** — PostgreSQL 18 | El esquema es relacional de verdad: 16 tablas, 13 restricciones de unicidad y claves foráneas |
| MP3 y portadas | **Cloudflare R2** — dos cubos | Servir 6 GB de audio desde el proceso costaba más que el proceso |

El reparto importa porque decide la factura. El audio **no pasa por el
servidor**: el API firma un enlace y el navegador descarga de Cloudflare, que no
cobra por servir. Lo único que sale de Render es JSON, así que el coste es plano
—unos $7 al mes— y no crece con los oyentes.

Los dos cubos de R2 están separados a propósito. El acceso público de R2 se
activa para el cubo entero, y las portadas tienen que ser públicas para poder ir
dentro de un `<img src>`; compartiendo cubo, abrirlas abriría también el audio.

| Cubo | Contenido | Acceso |
|---|---|---|
| `pulse-media` | Los MP3 | Privado, con URL firmada que caduca |
| `pulse-covers` | Las portadas | Público y cacheable |

La carpeta `storage/` del repo es solo el punto de partida local: de ahí salen
los archivos hacia R2 con `npm run upload-storage`. En producción no se lee.

Para desplegar desde cero: [DEPLOY.md](./DEPLOY.md).

## Desarrollo local

```powershell
npm.cmd install
Copy-Item .env.example .env      # y rellena los valores
npx.cmd prisma migrate deploy
npm.cmd run dev
```

La API queda en `http://localhost:4000/v1` y su documentación interactiva en
`http://localhost:4000/docs`.

### Variables

Ninguna es opcional salvo donde se diga. `SecurityConfig` y `StorageService`
las exigen por nombre y **lanzan al construir el módulo**, así que un arranque
al que le falte una no llega a escuchar en el puerto. Es a propósito: un
servidor con un secreto vacío firma tokens que cualquiera puede reproducir, y el
síntoma aparecería mucho después del despliegue que lo causó.

```dotenv
PORT=4000
PUBLIC_API_URL=http://localhost:4000/v1
DATABASE_URL=postgresql://pulse:pulse@localhost:5432/pulse?schema=public

# Sesiones. Distintos entre sí y de 32 caracteres o más. Con un solo secreto
# para ambos, un access token robado serviría como refresh.
JWT_ACCESS_SECRET=…
JWT_REFRESH_SECRET=…

# Firma las URLs de audio. Cambiarlo invalida al instante todos los enlaces
# repartidos, que es justo lo que se quiere si se filtra.
MEDIA_SIGNING_SECRET=…

# Almacenamiento. Protocolo S3, así que sirve R2, MinIO o el propio S3.
# El endpoint va sin el nombre del cubo al final.
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=pulse-media
S3_COVERS_BUCKET=pulse-covers
S3_ACCESS_KEY=…
S3_SECRET_KEY=…
COVERS_PUBLIC_URL=https://pub-<id>.r2.dev

PULSE_ADMIN_TOKEN=…

# Orígenes autorizados a llamar con credenciales, separados por comas.
# Vacío en desarrollo acepta cualquier puerto de localhost. En producción no
# hay red de seguridad: si queda vacío, ningún navegador puede usar el API y el
# único aviso es una línea en el log del arranque.
CORS_ORIGINS=

# `lax` mientras web y API compartan dominio. `none` si están en proveedores
# distintos; entonces la cookie exige HTTPS.
COOKIE_SAMESITE=lax

# Opcional. Sin proveedor de correo, restablecer contraseña y verificar el
# correo solo dejan el enlace en el log del servidor.
PUBLIC_WEB_URL=http://localhost:5173
```

### Scripts

```powershell
npm.cmd run dev              # servidor con recarga
npm.cmd run upload-storage   # sube storage/ a R2; repetible, salta lo ya subido
npm.cmd run create-admin -- correo@ejemplo.com "contraseña-larga"
npm.cmd run import           # importa un manifiesto de canciones
npm.cmd run seed:editorial   # géneros, moods y playlists del sistema
npm.cmd run classify:genres
```

`create-admin` existe porque el rol `ADMIN` no se puede pedir desde ningún
endpoint: si `/auth/register` aceptara un rol, cualquiera se daría de alta como
administrador. La primera cuenta con permisos tiene que nacer fuera del API.

Contra la base de producción, la cadena va delante del comando para no dejarla
activa en el `.env`:

```powershell
$env:DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require"
npm.cmd run create-admin -- correo@ejemplo.com "contraseña-larga"
```

## Superficie pública

### Catálogo y reproducción

- `GET /health` — no toca la base; solo confirma que el proceso vive
- `GET /catalog` — artistas, álbumes y pistas publicadas, con URLs absolutas
- `GET /tracks/:identifier/stream` — **302** hacia el archivo en R2
- `GET /media/covers/:file` — 301 hacia el cubo público

El identificador de una canción puede ser su UUID, su slug canónico o un ID
legado `tr-*`.

`/stream` no devuelve audio: comprueba la firma, busca la pista y redirige a una
URL temporal de R2. Las cabeceras `Range` —las que permiten saltar por la
canción— las atiende el almacenamiento, no este servidor.

La firma viaja dentro de la URL y no en una cabecera porque un `<audio src>` no
puede mandar cabeceras. Se calcula desde el principio de la hora en curso, de
modo que dos cargas del catálogo en la misma hora devuelven la misma URL: si
cambiara en cada petición, la clave de caché del navegador cambiaría con ella y
el reproductor volvería a descargar lo que ya tenía.

### Sesiones

```text
POST /auth/register          POST /auth/forgot-password
POST /auth/login             POST /auth/reset-password
POST /auth/refresh           POST /auth/verify-email/request
POST /auth/logout            POST /auth/verify-email
GET  /auth/me
```

El access token dura 15 minutos y viaja en `Authorization: Bearer`. El refresh
dura 30 días, es revocable y rota en cada uso. En el navegador sale en una
cookie `httpOnly` restringida a `/v1/auth`; un cliente sin cookies —la app
móvil— lo pide en el cuerpo mandando `X-Pulse-Client: native`.

Las contraseñas se guardan con argon2id. Los endpoints que las tocan aceptan 5
intentos por minuto y por IP, frente a los 120 del resto.

### Biblioteca del usuario

```text
GET   /me/library                      GET|PATCH  /me/preferences
PATCH /me/profile                      GET|POST   /me/playlists
PUT|DELETE /me/favourites/:trackId     PATCH|DELETE /me/playlists/:playlistId
PUT|DELETE /me/albums/:albumId         POST|DELETE  /me/history
PUT|DELETE /me/artists/:artistId       DELETE       /me/history/:entryId
```

## Mantenedor de canciones

Dos formas de entrar. Desde la web se entra con una cuenta de rol `ADMIN`; para
procesos sin persona detrás está la cabecera:

```http
X-Pulse-Admin-Token: tu-token
```

Si `PULSE_ADMIN_TOKEN` no está configurado, esa vía responde `503`. Si el valor
no coincide, `401`. La comparación se hace en tiempo constante.

### Listar canciones y álbumes

```http
GET /v1/admin/tracks
```

Devuelve `{ tracks, albums, artists }` e incluye canciones publicadas y no
publicadas, con artista, álbum, duración, género, estado, tamaño, streaming y
las carátulas propia, heredada y efectiva.

### Editar metadatos

```http
PATCH /v1/admin/tracks/:identifier
Content-Type: application/json

{ "title": "Nuevo nombre", "genre": "Rock alternativo", "explicit": false,
  "albumId": "uuid-del-album", "isPublished": true,
  "coverUrl": "/media/covers/hash.webp" }
```

Todos los campos son opcionales pero hay que enviar al menos uno. Para volver a
heredar la portada del álbum se usa `"coverUrl": null`. Al cambiar el álbum, la
API deriva el artista correcto.

### Subir una carátula

```http
POST /v1/admin/covers
Content-Type: multipart/form-data

cover=<archivo>
```

JPG, PNG o WebP de hasta 5 MB. Comprueba la firma binaria, sube el archivo a
`pulse-covers` con el hash de su contenido por nombre y devuelve
`{ "coverUrl": "/media/covers/..." }`.

Esa ruta relativa es lo que se guarda en la base, no la URL del almacenamiento:
la traducción a la dirección real ocurre al construir la respuesta, así que
cambiar de proveedor no obliga a reescribir ni una fila.

### Reemplazar el MP3

```http
POST /v1/admin/tracks/:identifier/audio
Content-Type: multipart/form-data

audio=<archivo.mp3>
duration=243
```

MP3 de hasta 60 MB y duración positiva en segundos. Valida la firma ID3/MPEG y
sube un objeto inmutable `slug-hash.mp3`. El archivo anterior no se borra, lo
que permite recuperarlo o aplicar una limpieza controlada más adelante.

### Publicar una canción

```http
POST /v1/admin/tracks
Content-Type: multipart/form-data

audio=<archivo.mp3>
cover=<archivo.jpg>          (opcional)
data={"slug":"get-lucky","title":"Get Lucky","duration":369,
      "artist":{"slug":"daft-punk","name":"Daft Punk"},
      "album":{"slug":"random-access-memories","title":"Random Access Memories","year":2013}}
```

Única puerta de entrada al catálogo, e idempotente por slug: reenviar una
canción ya publicada la actualiza en lugar de duplicarla, así que una subida
cortada se reintenta tal cual. Lo que llega incompleto entra pero queda en
espera y no aparece en `/catalog`; la respuesta lo dice en `pending`. Subir dos
veces el mismo audio con slugs distintos responde `409`.

> [!WARNING]
> Este endpoint reenvía el MP3 entero y recalcula su hash. Para mover un
> catálogo que ya existe **no se usa**: se copian la base y los archivos tal
> cual, que preserva los `storageKey` y evita subir dos veces lo mismo.

### Corregir un álbum

```http
PATCH /v1/admin/albums/:id
Content-Type: application/json

{ "year": 2013, "title": "Random Access Memories" }
```

El año es el único dato que retiene canciones fuera del catálogo, y vive en el
álbum, no en la canción. Al corregirlo se publican las que solo esperaban eso
—`published` dice cuántas—; una canción retirada a mano no vuelve.

## Documentación

El contrato vive en el código. Los decoradores `@Api*` de cada controlador y los
DTO de `class-validator` son la única fuente de verdad: de ahí salen a la vez la
validación de las peticiones y los esquemas publicados.

- **`GET /docs`** — Swagger UI. El botón *Authorize* acepta el token de
  administrador o un Bearer, y lo recuerda.
- **`GET /docs/openapi.json`** y **`GET /docs/openapi.yaml`** — el documento que
  sirve la instancia que está corriendo.
- [`openapi/pulse-api.yaml`](./openapi/pulse-api.yaml) — el mismo documento,
  versionado para generar clientes y ver los cambios del contrato en cada commit.

```powershell
npm.cmd run openapi        # regenera openapi/pulse-api.yaml desde el código
npm.cmd run openapi:check  # falla si el archivo no coincide con el código
```

`openapi:check` es lo que evita que el archivo vuelva a quedarse atrás: se
mantenía a mano y llegó a describir solo ocho de las diez operaciones que la API
servía de verdad.

## Lo que falta

**El correo no tiene proveedor.** [`mail.service.ts`](./src/auth/mail.service.ts)
escribe el mensaje en el log y `deliver` lanza si se configura `SMTP_URL`.
Mientras siga así, restablecer la contraseña solo funciona para quien pueda leer
los logs del servidor, y verificar el correo no puede ser requisito para usar la
cuenta. Conectar un proveedor real es sustituir `deliver`: el resto del código ya
habla con esa interfaz.

## Verificación

```powershell
npm.cmd run prisma:validate
npm.cmd run typecheck
npm.cmd run build
npm.cmd run openapi:check
```
