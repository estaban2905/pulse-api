-- CreateTable
CREATE TABLE "TvCommand" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "value" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TvCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TvCommand_userId_createdAt_idx" ON "TvCommand"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "TvCommand" ADD CONSTRAINT "TvCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
