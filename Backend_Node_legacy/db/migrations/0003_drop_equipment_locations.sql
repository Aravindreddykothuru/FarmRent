-- Live equipment positions are recorded by the API in gps_locations (the rental's trail, served by
-- GET /api/v1/tracking/booking/:id/history). equipment_locations was written only by the browser's direct
-- Supabase client and a Next.js device route, both removed; nothing reads or writes it any more.

DROP TABLE IF EXISTS equipment_locations;
