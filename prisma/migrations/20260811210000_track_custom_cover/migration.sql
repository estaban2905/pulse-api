-- Optional track-level artwork. When null, clients use the album artwork.
ALTER TABLE "Track" ADD COLUMN "coverUrl" TEXT;
