-- Migration 007: Add geofence_radius_km to bookings
-- Run in Supabase SQL Editor

ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS geofence_radius_km NUMERIC(6,2) DEFAULT 50;

COMMENT ON COLUMN bookings.geofence_radius_km IS
    'Geofence alert radius in km. Tracking service fires an alert when the driver '
    'moves beyond this distance from the booking pickup location. Default 50 km.';
