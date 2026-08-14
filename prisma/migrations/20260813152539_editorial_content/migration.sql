-- AlterTable
ALTER TABLE "Playlist" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "ownerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Genre" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mood" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodTrack" (
    "moodId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "MoodTrack_pkey" PRIMARY KEY ("moodId","trackId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Genre_slug_key" ON "Genre"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Genre_name_key" ON "Genre"("name");

-- CreateIndex
CREATE INDEX "Genre_position_idx" ON "Genre"("position");

-- CreateIndex
CREATE UNIQUE INDEX "Mood_slug_key" ON "Mood"("slug");

-- CreateIndex
CREATE INDEX "Mood_position_idx" ON "Mood"("position");

-- CreateIndex
CREATE UNIQUE INDEX "MoodTrack_moodId_position_key" ON "MoodTrack"("moodId", "position");

-- CreateIndex
CREATE INDEX "Playlist_isSystem_position_idx" ON "Playlist"("isSystem", "position");

-- AddForeignKey
ALTER TABLE "MoodTrack" ADD CONSTRAINT "MoodTrack_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodTrack" ADD CONSTRAINT "MoodTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
