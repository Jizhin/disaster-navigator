CREATE TYPE public.report_severity AS ENUM ('safe', 'warn', 'critical');

CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  district TEXT NOT NULL,
  message TEXT NOT NULL,
  severity public.report_severity NOT NULL DEFAULT 'warn',
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_created_at_idx ON public.reports (created_at DESC);

GRANT SELECT, INSERT ON public.reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reports are readable by anyone"
  ON public.reports FOR SELECT
  USING (true);

CREATE POLICY "Anyone can submit a community report"
  ON public.reports FOR INSERT
  WITH CHECK (
    length(district) BETWEEN 1 AND 80
    AND length(message) BETWEEN 1 AND 500
  );

ALTER TABLE public.reports REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.reports;

INSERT INTO public.reports (district, message, severity, category) VALUES
  ('Wayanad', 'Hairline fissures reported on Munnar Gap Road. Avoid transit.', 'critical', 'landslide'),
  ('Kochi', 'Minor waterlogging on MG Road.', 'warn', 'flood'),
  ('Thrissur', 'Main Highway cleared of debris.', 'safe', 'update'),
  ('Alappuzha', 'Ferry services suspended temporarily.', 'warn', 'transport');