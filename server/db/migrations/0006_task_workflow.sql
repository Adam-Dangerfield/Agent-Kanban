-- Stan rozmowy i odłożenia jest częścią karty; historia zmian trafia do activity.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow JSONB NOT NULL DEFAULT '{}'::jsonb;
