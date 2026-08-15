-- CreateEnum
CREATE TYPE "LyricStatus" AS ENUM ('SYNCED', 'PLAIN', 'INSTRUMENTAL', 'MISSING');

-- CreateTable
CREATE TABLE "Lyric" (
    "trackId" UUID NOT NULL,
    "status" "LyricStatus" NOT NULL,
    "syncedText" TEXT,
    "plainText" TEXT,
    "source" TEXT NOT NULL DEFAULT 'lrclib',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lyric_pkey" PRIMARY KEY ("trackId")
);

-- CreateIndex
CREATE INDEX "Lyric_status_fetchedAt_idx" ON "Lyric"("status", "fetchedAt");

-- AddForeignKey
ALTER TABLE "Lyric" ADD CONSTRAINT "Lyric_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
