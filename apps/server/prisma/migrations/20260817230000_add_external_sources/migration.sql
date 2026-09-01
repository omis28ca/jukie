-- AlterTable
ALTER TABLE "Song" ADD COLUMN "sourceProvider" TEXT;
ALTER TABLE "Song" ADD COLUMN "sourceId" TEXT;
ALTER TABLE "Song" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Song" ADD COLUMN "licenseUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Song_sourceProvider_sourceId_key" ON "Song"("sourceProvider", "sourceId");
