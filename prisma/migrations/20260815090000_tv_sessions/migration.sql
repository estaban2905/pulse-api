-- CreateTable
CREATE TABLE "TvSession" (
    "id" UUID NOT NULL,
    "code" TEXT,
    "codeExpiry" TIMESTAMP(3),
    "tokenHash" VARCHAR(64) NOT NULL,
    "userId" UUID,
    "name" TEXT NOT NULL DEFAULT 'Televisor',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TvSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NowPlaying" (
    "userId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "positionMs" INTEGER NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NowPlaying_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TvSession_code_key" ON "TvSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TvSession_tokenHash_key" ON "TvSession"("tokenHash");

-- CreateIndex
CREATE INDEX "TvSession_userId_lastSeenAt_idx" ON "TvSession"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "TvSession_codeExpiry_idx" ON "TvSession"("codeExpiry");

-- AddForeignKey
ALTER TABLE "TvSession" ADD CONSTRAINT "TvSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NowPlaying" ADD CONSTRAINT "NowPlaying_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
