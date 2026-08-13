# Desplegar pulse-api en Render

La API guarda el audio en el disco local y el catálogo en PostgreSQL, así que
mover el servicio son dos migraciones distintas: la base de datos y los 4,1 GB
de `storage/`.

Ninguno de los dos pasos usa el endpoint `POST /v1/admin/tracks`. Publicar
reenvía el MP3 entero y recalcula su hash; copiar la base y el disco tal cual
preserva los `storageKey` existentes y evita subir dos veces lo mismo.

---

## 1. Crear la infraestructura

En Render: **New → Blueprint**, apuntando a `estaban2905/pulse-api`. Lee
[`render.yaml`](render.yaml) y crea el servicio web, la base y el disco de
10 GB.

`PULSE_ADMIN_TOKEN` y `JWT_SECRET` se generan solos. Cópialos del panel
(*Environment*) si los necesitas desde un cliente.

Si el servicio queda con un nombre distinto de `pulse-api`, corrige
`PUBLIC_API_URL` para que apunte a su dominio real.

### Coste aproximado

| Recurso | Plan | Mensual |
|---|---|---|
| Servicio web | Starter | ~$7 |
| Disco persistente | 10 GB | ~$2,50 |
| PostgreSQL | Basic 256 MB | ~$6 |

El disco obliga a instancia de pago y a una sola réplica: los despliegues tienen
un corte breve, porque el disco no se puede montar en dos instancias a la vez.

---

## 2. Migrar PostgreSQL

El volcado incluye la tabla `_prisma_migrations`, así que el `prisma migrate
deploy` del pre-deploy encuentra las dos migraciones ya aplicadas y no hace
nada. No hay que ejecutarlas a mano.

Con el Postgres local levantado (`docker compose up -d postgres`):

```bash
docker compose exec -T postgres \
  pg_dump -U pulse -d pulse --clean --if-exists --no-owner --no-privileges \
  > pulse.sql
```

Copia la **External Database URL** desde el panel de la base en Render y
restaura. El contenedor ya trae `psql`, así que no necesitas cliente local:

```bash
cat pulse.sql | docker compose exec -T postgres \
  psql "postgresql://...@...virginia-postgres.render.com/pulse?sslmode=require"
```

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

## 3. Subir `storage/` al disco

Render da acceso SSH a los servicios de pago. Copia el comando de conexión
desde la pestaña **Shell** del servicio (tiene la forma
`srv-xxxxxxxx@ssh.virginia.render.com`).

Son 781 MP3 y 189 portadas. Con `tar` sobre SSH viajan en un solo flujo, sin
abrir una conexión por archivo:

```bash
tar cf - storage | ssh srv-xxxxxxxx@ssh.virginia.render.com \
  "cd /opt/render/project/src && tar xf -"
```

Sin `-z`: los MP3 ya están comprimidos y gzip solo gastaría CPU.

Cuenta con horas, no minutos — 4,1 GB salen a la velocidad de subida de tu
conexión, no de la bajada. Si se corta, `rsync` reanuda desde donde iba:

```bash
rsync -av --partial --progress -e ssh \
  storage/ srv-xxxxxxxx@ssh.virginia.render.com:/opt/render/project/src/storage/
```

Verifica que llegó todo:

```bash
ssh srv-xxxxxxxx@ssh.virginia.render.com \
  "ls /opt/render/project/src/storage/audio | wc -l"   # 781
```

---

## 4. Comprobar

```bash
curl https://pulse-api.onrender.com/v1/health
curl https://pulse-api.onrender.com/v1/catalog | head -c 400
```

Y una pista real, que es lo único que prueba que el disco quedó bien montado:

```bash
curl -sI -H 'Range: bytes=0-1023' \
  https://pulse-api.onrender.com/v1/tracks/get-lucky/stream
```

Debe responder `206 Partial Content` con `Content-Range`. Un `404` significa
que la fila existe en la base pero el MP3 no está en el disco.

La documentación queda en `https://pulse-api.onrender.com/docs`.

---

## Después: clientes

`pulse-web` y `pulse-mobile` apuntan al `localhost:4000` local. Hay que
cambiarles la URL base a la de Render antes de que sirvan de algo contra este
despliegue.

`enableCors({ origin: true })` en [`src/main.ts`](src/main.ts) acepta cualquier
origen. Va bien para probar; conviene restringirlo a los dominios reales cuando
el frontend tenga el suyo.
