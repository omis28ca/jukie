-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "album" TEXT,
    "genre" TEXT,
    "year" INTEGER,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mimeType" TEXT,
    "artworkFilename" TEXT,
    "artworkMimeType" TEXT,
    "artworkPath" TEXT,
    "duration" INTEGER,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "songId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "requesterKey" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QueueItem_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "QueueItem_status_createdAt_idx" ON "QueueItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "QueueItem_requesterKey_status_idx" ON "QueueItem"("requesterKey", "status");
