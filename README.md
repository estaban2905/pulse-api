# Pulse API

API común para Pulse Web y Pulse Mobile. Está construida con NestJS 11,
Fastify 5, Prisma 7 y PostgreSQL. Expone el catálogo, las carátulas, streaming
MP3 con HTTP Range y un mantenedor local protegido para administrar canciones.

## Desarrollo local

```powershell
npm.cmd install
Copy-Item .env.example .env
npx.cmd prisma migrate deploy
npm.cmd run dev
```

La API queda disponible en `http://localhost:4000/v1`, y su documentación
interactiva en `http://localhost:4000/docs`.

Variables mínimas:

```dotenv
PORT=4000
PUBLIC_API_URL=http://localhost:4000/v1
DATABASE_URL=postgresql://pulse:pulse@localhost:5432/pulse?schema=public
PULSE_ADMIN_TOKEN=reemplaza-esto-por-un-token-largo-y-aleatorio
```

Si `PULSE_ADMIN_TOKEN` no está configurado, todos los endpoints administrativos
responden `503`. Si el header falta o no coincide, responden `401`. La
comparación del secreto se hace en tiempo constante.

## API pública

- `GET /health`
- `GET /catalog`
- `GET /tracks/:identifier/stream`
- `GET /media/covers/:file`

El identificador de una canción puede ser su UUID, su slug canónico o un ID
legado `tr-*`. `GET /catalog` entrega UUID, `streamUrl` y `coverUrl` efectivos;
una carátula propia de la canción tiene prioridad sobre la del álbum.

## Mantenedor de canciones

Todas las solicitudes usan este header:

```http
X-Pulse-Admin-Token: tu-token
```

### Listar canciones y álbumes

```http
GET /v1/admin/tracks
```

Devuelve `{ tracks, albums }` e incluye canciones publicadas y no publicadas.
Cada canción contiene artista, álbum, duración, género, estado, tamaño,
streaming y las carátulas propia, heredada y efectiva.

### Editar metadatos

```http
PATCH /v1/admin/tracks/:identifier
Content-Type: application/json

{
  "title": "Nuevo nombre",
  "genre": "Rock alternativo",
  "explicit": false,
  "albumId": "uuid-del-album",
  "isPublished": true,
  "coverUrl": "/media/covers/hash.webp"
}
```

Todos los campos son opcionales, pero se debe enviar al menos uno. Para volver
a heredar la portada del álbum se usa `"coverUrl": null`. Cuando cambia el
álbum, la API deriva automáticamente el artista correcto.

### Subir una carátula

```http
POST /v1/admin/covers
Content-Type: multipart/form-data

cover=<archivo>
```

Acepta JPG, PNG o WebP de hasta 5 MB. La API comprueba la firma binaria, guarda
el archivo con un hash estable y devuelve `{ "coverUrl": "/media/covers/..." }`.

### Reemplazar el MP3

```http
POST /v1/admin/tracks/:identifier/audio
Content-Type: multipart/form-data

audio=<archivo.mp3>
duration=243
```

Acepta MP3 de hasta 60 MB y una duración positiva en segundos. La API valida la
firma ID3/MPEG, crea un objeto inmutable `slug-hash.mp3` y actualiza la canción.
El archivo anterior no se borra automáticamente, lo que permite recuperarlo o
aplicar una política de limpieza controlada más adelante.

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

El contrato vive en el código. Los decoradores `@Api*` de cada controlador y
los DTO de `class-validator` son la única fuente de verdad: de ahí salen a la
vez la validación de las peticiones y los esquemas publicados.

- **`GET /docs`** — Swagger UI. El botón *Authorize* pide el token de
  administrador y lo recuerda, así que las rutas `/admin` se pueden probar
  desde ahí.
- **`GET /docs/openapi.json`** y **`GET /docs/openapi.yaml`** — el documento
  que sirve la instancia que está corriendo.
- [`openapi/pulse-api.yaml`](./openapi/pulse-api.yaml) — el mismo documento,
  versionado en el repositorio para poder generar clientes y ver los cambios
  del contrato en cada commit.

```powershell
npm.cmd run openapi        # regenera openapi/pulse-api.yaml desde el código
npm.cmd run openapi:check  # falla si el archivo no coincide con el código
```

`openapi:check` es la comprobación que evita que el archivo vuelva a quedarse
atrás: se mantenía a mano y llegó a describir solo ocho de las diez operaciones
que la API servía de verdad.

## Seguridad: local frente a producción

`PULSE_ADMIN_TOKEN` es adecuado para desarrollo local o una herramienta interna
en una red de confianza. No se debe incluir un secreto administrativo en un
bundle web público (`VITE_*`), porque cualquier visitante puede leerlo.

Antes de publicar el mantenedor se debe reemplazar este mecanismo por login,
JWT de corta duración, usuarios con rol `ADMIN`, autorización por endpoint,
rate limiting, auditoría de cambios y almacenamiento de medios en S3/R2. El
token local puede mantenerse como acceso de emergencia sólo del lado servidor.

## Datos y archivos

La carpeta `storage/` sirve para desarrollo local. En producción debe sustituirse
por almacenamiento de objetos y URLs firmadas. Después de importar o restaurar
el catálogo de demostración, se pueden reaplicar sus asociaciones revisadas con:

```powershell
npm.cmd run curate:covers
```

El importador no reemplaza una carátula existente cuando el manifiesto nuevo no
incluye una imagen válida.

## Verificación

```powershell
npm.cmd run prisma:validate
npm.cmd run typecheck
npm.cmd run build
npm.cmd run openapi:check
```
