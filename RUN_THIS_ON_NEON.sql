-- ========================================
-- RUN THIS ON YOUR NEON DATABASE (SQL Editor)
-- ========================================
-- Fixes: "The column autoEnrich does not exist in the current database"
-- Safe to re-run (IF NOT EXISTS on every statement).
-- ========================================

-- Settings: search / pacing
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "platformUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "searchOnlyMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "searchConfigJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "maxSearchesPerHour" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "maxSearchesPerDay" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "minDelayBetweenSearchesMinutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "maxKeywordsPerCycle" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "maxCommentsPerHour" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "maxCommentsPerWeek" INTEGER NOT NULL DEFAULT 100;

-- Settings: auto-enrich (the columns that broke registration)
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "autoEnrich" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "autoDelete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "deleteThreshold" INTEGER NOT NULL DEFAULT 10;

-- Settings: proxy + extension telemetry
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "proxyHost" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "proxyPort" INTEGER;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "proxyUser" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "proxyPass" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "lastHeartbeat" TIMESTAMP(3);
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "extensionStatus" TEXT;

-- SavedPost columns used by the extension
ALTER TABLE "SavedPost" ADD COLUMN IF NOT EXISTS "canonicalUrn" TEXT;
ALTER TABLE "SavedPost" ADD COLUMN IF NOT EXISTS "engagementScore" INTEGER;

-- Unique dedup index (ignore if already exists)
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "SavedPost_userId_canonicalUrn_key"
    ON "SavedPost"("userId", "canonicalUrn");
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS "SavedPost_userId_engagementScore_idx"
    ON "SavedPost"("userId", "engagementScore");
EXCEPTION WHEN others THEN NULL;
END $$;

-- Verify autoEnrich exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'Settings'
  AND column_name IN ('autoEnrich', 'autoDelete', 'deleteThreshold', 'searchOnlyMode', 'platformUrl')
ORDER BY column_name;
