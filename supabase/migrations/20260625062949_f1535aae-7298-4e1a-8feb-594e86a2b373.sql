ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS place text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lon double precision,
  ADD COLUMN IF NOT EXISTS image_url text;