-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "favouriteGenres" TEXT[];

-- DropEnum
DROP TYPE "DownloadStatus";
