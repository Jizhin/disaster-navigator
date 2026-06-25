CREATE POLICY "Public can upload report images"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id = 'report-images');

CREATE POLICY "Public can read report images"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'report-images');