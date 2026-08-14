-- La clave canónica pasa a ser obligatoria y única.
--
-- El código ya rechaza los duplicados, pero el candado vive aquí: una vía
-- futura que olvide comprobarlo se estrella contra la base de datos en vez de
-- volver a permitir dos cuentas sobre el mismo buzón.
DROP INDEX IF EXISTS "User_emailKey_idx";

ALTER TABLE "User" ALTER COLUMN "emailKey" SET NOT NULL;

CREATE UNIQUE INDEX "User_emailKey_key" ON "User"("emailKey");
