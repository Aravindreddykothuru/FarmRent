/**
 * POST /api/tracking/update
 *
 * Hardware GPS device endpoint — for SIM-based vehicle trackers.
 * Authentication: x-device-secret header must match TRACKING_DEVICE_SECRET env var.
 * Rate-limit: max 1 request per 10 seconds per device_id (in-memory Map).
 *
 * Body:
 *   device_id   string   — hardware device identifier
 *   equipment_id uuid    — Supabase equipment row id
 *   booking_id  uuid     — Supabase booking row id
 *   lat         number   — latitude
 *   lng         number   — longitude
 *   speed       number?  — km/h
 *   heading     number?  — degrees
 *   altitude    number?  — metres
 *   timestamp   string?  — ISO 8601
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── In-memory rate-limit store (resets on cold start) ─────────────────────────
// Map<device_id, last_request_timestamp_ms>
const deviceLastSeen = new Map<string, number>();
const RATE_LIMIT_MS  = 10_000; // 10 seconds

// ── Supabase admin client (service role — bypasses RLS) ───────────────────────
function getSupabaseAdmin() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svcKey) return null;
  return createClient(url, svcKey, {
    auth: { persistSession: false },
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Authenticate via device secret
  const deviceSecret  = req.headers.get('x-device-secret');
  const expectedSecret = process.env.TRACKING_DEVICE_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'TRACKING_DEVICE_SECRET env variable not configured' },
      { status: 500 },
    );
  }

  if (!deviceSecret || deviceSecret !== expectedSecret) {
    return NextResponse.json(
      { error: 'Unauthorized — invalid device secret' },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    device_id,
    equipment_id,
    booking_id,
    lat,
    lng,
    speed,
    heading,
    altitude,
  } = body as Record<string, unknown>;

  // 3. Validate required fields
  if (!device_id || typeof device_id !== 'string') {
    return NextResponse.json({ error: 'device_id is required' }, { status: 400 });
  }
  if (!equipment_id || typeof equipment_id !== 'string') {
    return NextResponse.json({ error: 'equipment_id is required' }, { status: 400 });
  }
  if (!booking_id || typeof booking_id !== 'string') {
    return NextResponse.json({ error: 'booking_id is required' }, { status: 400 });
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (isNaN(latNum) || latNum < -90  || latNum > 90) {
    return NextResponse.json({ error: 'lat must be between -90 and 90' }, { status: 400 });
  }
  if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return NextResponse.json({ error: 'lng must be between -180 and 180' }, { status: 400 });
  }

  // 4. Rate-limiting per device_id (1 req / 10 s)
  const now      = Date.now();
  const lastSeen = deviceLastSeen.get(device_id) ?? 0;
  if (now - lastSeen < RATE_LIMIT_MS) {
    const retryAfterSec = Math.ceil((RATE_LIMIT_MS - (now - lastSeen)) / 1000);
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry after ${retryAfterSec}s.` },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      },
    );
  }
  deviceLastSeen.set(device_id, now);

  // 5. Verify booking exists and is active
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: 'Supabase service role key not configured' },
      { status: 500 },
    );
  }

  const { data: booking, error: bookingErr } = await supabaseAdmin
    .from('bookings')
    .select('id, status, equipment_id')
    .eq('id', booking_id)
    .single();

  if (bookingErr || !booking) {
    return NextResponse.json(
      { error: 'Booking not found' },
      { status: 404 },
    );
  }

  const activeStatuses = ['confirmed', 'in_progress', 'active'];
  if (!activeStatuses.includes((booking as Record<string, string>).status)) {
    return NextResponse.json(
      { error: `Booking is not active (status: ${(booking as Record<string, string>).status})` },
      { status: 422 },
    );
  }

  // 6. Insert location point
  const { error: insertErr } = await supabaseAdmin
    .from('equipment_locations')
    .insert({
      equipment_id,
      booking_id,
      lat:       latNum,
      lng:       lngNum,
      speed:     speed   != null ? Number(speed)   : null,
      heading:   heading != null ? Number(heading) : null,
      altitude:  altitude != null ? Number(altitude) : null,
      source:    'vehicle_gps',
      device_id,
      updated_at: new Date().toISOString(),
    });

  if (insertErr) {
    console.error('[GPS API] Insert failed:', insertErr.message);
    return NextResponse.json(
      { error: 'Failed to save location', detail: insertErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success:     true,
    received_at: new Date().toISOString(),
  });
}

// ── Reject all other HTTP methods ─────────────────────────────────────────────

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST.' },
    { status: 405 },
  );
}
