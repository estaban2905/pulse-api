-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailKey" TEXT;

-- CreateIndex
CREATE INDEX "User_emailKey_idx" ON "User"("emailKey");

-- Rellena la clave canónica de las cuentas que ya existían.
--
-- Replica en SQL lo que hace `canonicalEmail`: minúsculas siempre, y para los
-- buzones de Google además quitar la subdirección `+etiqueta` y los puntos de
-- la parte local, que Gmail ignora.
UPDATE "User"
SET "emailKey" = CASE
  WHEN split_part(lower("email"), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', '') || '@gmail.com'
  WHEN split_part(lower("email"), '@', 2) IN (
        'outlook.com','hotmail.com','live.com','icloud.com','me.com',
        'yahoo.com','proton.me','protonmail.com','fastmail.com')
    THEN split_part(split_part(lower("email"), '@', 1), '+', 1) || '@' || split_part(lower("email"), '@', 2)
  ELSE lower("email")
END;
