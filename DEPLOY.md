# Desplegar pulse-api en Render

El catálogo vive en PostgreSQL y los archivos en Cloudflare R2, así que montar
esto son dos migraciones distintas: la base de datos y los 6,0 GB de `storage/`.

Ninguno de los dos pasos usa el endpoint `POST /v1/admin/tracks`. Publicar
reenvía el MP3 entero y recalcula su hash; copiar la base y los archivos tal
cual preserva los `storageKey` existentes y evita subir dos veces lo mismo.

---

## 1. Crear la infraestructura

Antes del blueprint hace falta la base de datos, porque Render ya no la crea:
en [Neon](https://neon.com), proyecto nuevo en **US East** y copiar la cadena de
conexión. La **directa**, no la del pooler — el pooler agrupa por transacción y
`prisma migrate deploy` perdería los bloqueos de sesión que necesita.

En Render: **New → Blueprint**, apuntando a `estaban2905/pulse-api`. Lee
[`render.yaml`](render.yaml) y crea solo el servicio web. Ni base ni disco: la
primera está en Neon y los archivos en R2.

`PULSE_ADMIN_TOKEN` y los tres secretos de firma —`JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET` y `MEDIA_SIGNING_SECRET`— se generan solos. Cópialos del
panel (*Environment*) si los necesitas desde un cliente.

Render pedirá estos valores al crear el blueprint, porque no se pueden deducir
desde aquí:

| Variable | Qué es | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Cadena directa de Neon | `postgresql://…@ep-….neon.tech/neondb?sslmode=require` |
| `PUBLIC_WEB_URL` | Base de los enlaces de restablecer contraseña y verificar correo | `https://pulse.app` |
| `CORS_ORIGINS` | Orígenes autorizados a llamar con credenciales, separados por comas | `https://pulse.app,https://www.pulse.app` |
| `S3_ENDPOINT` | Endpoint de R2, sin el nombre del cubo | `https://….r2.cloudflarestorage.com` |
| `COVERS_PUBLIC_URL` | Base pública del cubo de portadas | `https://pub-….r2.dev` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciales del token de R2 | — |

Los dos primeros apuntan a la **web**, no al API. Si `CORS_ORIGINS` queda vacío
el servicio arranca igual, pero ningún navegador podrá usarlo: en producción no
hay lista de reserva, y el único aviso es una línea en el log del arranque.

Las de R2 sí paran el arranque: `StorageService` las exige por nombre y lanza al
construir el módulo, así que sin ellas el servicio no llega a escuchar.

Si el servicio queda con un nombre distinto de `pulse-api`, corrige
`PUBLIC_API_URL` para que apunte a su dominio real.

`COOKIE_SAMESITE` viene fijado a `none` porque web y API quedan en dominios
distintos y el navegador descartaría una cookie `lax`. Si algún día comparten
dominio de nivel superior (`pulse.app` y `api.pulse.app`), cámbialo a `lax`.

### Coste aproximado

| Recurso | Plan | Mensual |
|---|---|---|
| Servicio web (Render) | Starter | ~$7 |
| PostgreSQL (Neon) | 11 MB de 0,5 GB gratuitos | $0 |
| Archivos (Cloudflare R2) | 6 GB de 10 GB gratuitos | $0 |

**$7 al mes, y plano**: lo único que sale de Render es JSON, así que la factura
no crece con los oyentes. Cuando el audio salía del disco, cada reproducción
eran 5,3 MB de ancho de banda a $0,15/GB, y con cien oyentes eso sumaba unos $35
al mes solo de tráfico. R2 no cobra por servir.

La base de Render costaba $10,50 para guardar 11 MB. Neon da 0,5 GB gratis —45
veces lo que ocupa el catálogo— a cambio de suspenderse cuando nadie la usa y
tardar medio segundo en despertar.

El plan **Hobby** basta: Pro cuesta $25 al mes más y sus 20 GB extra de ancho de
banda valen $3, así que nunca compensa. Su función estrella —el escalado
horizontal— tampoco aplicaba mientras hubo disco, y ahora ya no hay disco que lo
impida.

---

## 2. Migrar PostgreSQL

El volcado incluye la tabla `_prisma_migrations`, así que el `prisma migrate
deploy` del pre-deploy encuentra las ocho migraciones ya aplicadas y no hace
nada. No hay que ejecutarlas a mano.

Con el Postgres local levantado (`docker compose up -d postgres`):

```bash
docker compose exec -T postgres \
  pg_dump -U pulse -d pulse --clean --if-exists --no-owner --no-privileges \
  > pulse.sql
```

Y restaura contra Neon. El contenedor ya trae `psql`, así que no necesitas
cliente local:

```bash
cat pulse.sql | docker compose exec -T postgres \
  psql "postgresql://…@ep-….neon.tech/neondb?sslmode=require"
```

Neon sirve Postgres 18 y el volcado sale de un 17: restaurar hacia una versión
mayor es la dirección compatible, y el aviso de versión que suelta `psql` no
significa nada aquí.

`--clean --if-exists` hace la restauración repetible: puedes relanzarla sin
dejar la base a medias.

Comprueba el resultado:

```bash
docker compose exec -T postgres \
  psql "postgresql://...?sslmode=require" \
  -c 'select count(*) from "Track" where "isPublished";'
```

Borra `pulse.sql` cuando termines: lleva el catálogo entero.

---

## 3. Subir los archivos a R2

El audio y las portadas ya no viven en el disco del servidor: el API solo emite
enlaces y el navegador descarga de Cloudflare. Por eso este paso va contra R2 y
no por SSH, y por eso `render.yaml` ya no declara ningún disco.

Hacen falta **dos cubos**. El acceso público de R2 no se puede limitar a una
parte del contenido, y las portadas tienen que ser públicas para poder ir dentro
de un `<img src>`: compartiendo cubo, abrir unas abriría también el audio.

| Cubo | Contenido | Acceso |
|---|---|---|
| `pulse-media` | Los 1155 MP3 | Privado, con URL firmada |
| `pulse-covers` | Las 224 portadas | Público, URL fija y cacheable |

En el panel de R2: crea `pulse-covers`, entra en sus **Settings** y activa la
**Public Development URL**. Copia la dirección `https://pub-….r2.dev` que te dé
y ponla en `COVERS_PUBLIC_URL`. En `pulse-media` no actives nada: sigue privado.

Con las variables `S3_*` y `COVERS_PUBLIC_URL` puestas, mira primero qué se va
a subir:

```bash
npm run upload-storage -- --dry-run
```

Y luego sube de verdad:

```bash
npm run upload-storage
```

Cuenta con horas, no minutos: 6,0 GB salen a la velocidad de subida de tu
conexión, no de la bajada. Es repetible —antes de cada archivo comprueba si ya
está con el mismo tamaño—, así que si se corta, se relanza y sigue donde iba.

**Este paso va antes del primer despliegue.** El servicio ya no tiene disco al
que recurrir: si arranca con los cubos vacíos, el catálogo carga pero no suena
nada.

---

## 4. Comprobar

```bash
curl https://pulse-api.onrender.com/v1/health
curl https://pulse-api.onrender.com/v1/catalog | head -c 400
```

Y una pista real, que es lo único que prueba que los cubos quedaron bien. La
firma va en la URL, así que hay que sacar una del catálogo en vez de inventarla:

```bash
curl -sL -o /dev/null -w '%{http_code} %{size_download}\n' \
  "$(curl -s https://pulse-api.onrender.com/v1/catalog \
     | grep -o 'https://[^"]*tracks/[^"]*stream[^"]*' | head -1)"
```

`-L` sigue la redirección hasta R2. Debe acabar en `200` con varios megas
descargados. Un `403` significa que el enlace ya caducó o que las credenciales de
R2 no cuadran; un `404` de Cloudflare, que la fila está en la base pero el MP3 no
llegó al cubo.

Y una portada, que va directa y sin firmar:

```bash
curl -sI "$(curl -s https://pulse-api.onrender.com/v1/catalog \
  | grep -o 'https://pub-[^"]*' | head -1)"
```

Un `200` confirma que `pulse-covers` tiene activado el acceso público. Un `401`
quiere decir que se quedó privado.

La documentación queda en `https://pulse-api.onrender.com/docs`.

---

## Después: clientes

`pulse-web` y `pulse-mobile` apuntan al `localhost:4000` local. Hay que
cambiarles la URL base a la de Render antes de que sirvan de algo contra este
despliegue.

Y el viaje es de ida y vuelta: el origen desde el que quede servida la web tiene
que estar en `CORS_ORIGINS`. [`src/main.ts`](src/main.ts) ya no refleja cualquier
origen —dejó de ser inocuo al aparecer la cookie de sesión—, así que un dominio
que falte en esa lista no da un error claro, sino un catálogo que no carga.

El correo todavía no tiene proveedor: [`mail.service.ts`](src/auth/mail.service.ts)
escribe el mensaje en el log del servidor y `deliver` lanza si se configura
`SMTP_URL`. Hasta que se conecte uno, restablecer la contraseña solo funciona
para quien pueda leer los logs de Render, y verificar el correo no puede ser
requisito para usar la cuenta. Déjalo sin configurar.
