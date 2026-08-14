-- CreateTable
CREATE TABLE "AlbumSave" (
    "userId" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumSave_pkey" PRIMARY KEY ("userId","albumId")
);

-- AddForeignKey
ALTER TABLE "AlbumSave" ADD CONSTRAINT "AlbumSave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlbumSave" ADD CONSTRAINT "AlbumSave_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
