-- CreateTable
CREATE TABLE "Mood" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MoodSong" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moodId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "MoodSong_moodId_fkey" FOREIGN KEY ("moodId") REFERENCES "Mood" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MoodSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Mood_name_idx" ON "Mood"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MoodSong_moodId_position_key" ON "MoodSong"("moodId", "position");

-- CreateIndex
CREATE INDEX "MoodSong_moodId_position_idx" ON "MoodSong"("moodId", "position");

-- CreateIndex
CREATE INDEX "MoodSong_songId_idx" ON "MoodSong"("songId");
