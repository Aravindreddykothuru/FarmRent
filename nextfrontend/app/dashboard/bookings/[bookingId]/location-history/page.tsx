'use client';

/**
 * /dashboard/bookings/[bookingId]/location-history
 *
 * Full path replay + analytics for a completed or active booking.
 * Visible to BOTH owner and renter after booking starts.
 *
 * Features:
 *  • Full Leaflet polyline of all recorded points
 *  • Start / End markers
 *  • Total distance (Haversine sum of consecutive points)
 *  • Average speed
 *  • Duration of tracking session
 *  • Download GPX export
 */

import { useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, AlertTriangle, Loader2,
  MapPin, Navigation, Clock, Gauge, Route,
  Download,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationRow {
  id:         string;
  lat:        number;
  lng:        number;
  speed:      number | null;
  heading:    number | null;
  accuracy:   number | null;
  altitude:   number | null;
  updated_at: string;
}

// ── Haversine ─────────────────────────────────────────────────────────────────

function haversineMetres(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R    = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeStats(rows: LocationRow[]) {
  if (rows.length < 2) return null;

  let totalDistM = 0;
  const speedSamples: number[] = [];

  for (let i = 1; i < rows.length; i++) {
    totalDistM += haversineMetres(
      rows[i - 1].lat, rows[i - 1].lng,
      rows[i].lat,     rows[i].lng,
    );
    if (rows[i].speed != null && rows[i].speed! > 0) {
      speedSamples.push(rows[i].speed!);
    }
  }

  const avgSpeed = speedSamples.length
    ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
    : null;

  const first = new Date(rows[0].updated_at).getTime();
  const last  = new Date(rows[rows.length - 1].updated_at).getTime();
  const durationMs = last - first;

  return {
    totalDistKm:  totalDistM / 1000,
    avgSpeedKmh:  avgSpeed,
    durationMs,
    pointCount:   rows.length,
  };
}

// ── Leaflet icon patch ────────────────────────────────────────────────────────

let _patched = false;
function patchLeafletIcons() {
  if (_patched) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require('leaflet');
  delete (L.Icon.Default.prototype as Record<string, unknown>)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
  _patched = true;
}

// ── Map inner ─────────────────────────────────────────────────────────────────

const SizeWatcher = memo(function SizeWatcher() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useMap } = require('react-leaflet');
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize({ animate: false }), 80);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
});

function HistoryMapInner({
  trail,
  startPos,
  endPos,
}: {
  trail:    [number, number][];
  startPos: [number, number] | null;
  endPos:   [number, number] | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } = require('react-leaflet');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const L = require('leaflet');
  patchLeafletIcons();

  const centerRef = useRef<[number, number]>(
    startPos ?? [20.5937, 78.9629],
  );

  function FitBoundsController() {
    const map = useMap();
    useEffect(() => {
      if (trail.length < 2) return;
      const bounds = L.latLngBounds(trail);
      map.fitBounds(bounds, { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  const startIcon = L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:linear-gradient(135deg,#16a34a,#15803d);
      border:3px solid white;display:flex;align-items:center;
      justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.3);
    ">▶</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], className: '',
  });

  const endIcon = L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:linear-gradient(135deg,#ef4444,#b91c1c);
      border:3px solid white;display:flex;align-items:center;
      justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.3);
    ">■</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], className: '',
  });

  return (
    <MapContainer
      center={centerRef.current}
      zoom={13}
      style={{ height: '100%', width: '100%' }}
      zoomControl={true}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
        maxZoom={19}
      />
      <SizeWatcher />
      <FitBoundsController />

      {/* Full path */}
      {trail.length > 1 && (
        <Polyline
          positions={trail}
          color="#3b82f6"
          weight={4}
          opacity={0.75}
        />
      )}

      {/* Start marker */}
      {startPos && (
        <Marker position={startPos} icon={startIcon}>
          <Popup><span className="text-sm font-semibold">🟢 Start</span></Popup>
        </Marker>
      )}

      {/* End marker */}
      {endPos && (
        <Marker position={endPos} icon={endIcon}>
          <Popup><span className="text-sm font-semibold">🔴 End</span></Popup>
        </Marker>
      )}
    </MapContainer>
  );
}

const DynamicMap = dynamic(() => Promise.resolve(HistoryMapInner), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-gray-100 flex items-center justify-center animate-pulse">
      <MapPin className="h-8 w-8 text-gray-300" />
    </div>
  ),
});

// ── GPX export ────────────────────────────────────────────────────────────────

function buildGpx(rows: LocationRow[], bookingId: string): string {
  const trackPts = rows
    .map(r =>
      `    <trkpt lat="${r.lat}" lon="${r.lng}">
      <time>${r.updated_at}</time>
      ${r.altitude != null ? `<ele>${r.altitude}</ele>` : ''}
      ${r.speed != null ? `<extensions><speed>${r.speed}</speed></extensions>` : ''}
    </trkpt>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FarmDirect" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Equipment Trip — Booking ${bookingId.slice(-8).toUpperCase()}</name>
    <time>${rows[0]?.updated_at ?? new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>Equipment Route</name>
    <trkseg>
${trackPts}
    </trkseg>
  </trk>
</gpx>`;
}

// ── Duration formatter ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LocationHistoryPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const router        = useRouter();

  const [rows,    setRows]    = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  // ── Fetch all location points ───────────────────────────────────────────────
  useEffect(() => {
    if (!bookingId || !supabase) { setLoading(false); return; }

    const fetchRows = async () => {
      try {
        const { data, error: err } = await supabase!
          .from('equipment_locations')
          .select('id, lat, lng, speed, heading, accuracy, altitude, updated_at')
          .eq('booking_id', bookingId)
          .order('updated_at', { ascending: true });
        if (err) { setError(err.message); return; }
        setRows(
          (data ?? []).map(r => {
            const row = r as Record<string, unknown>;
            return {
              id:         String(row.id),
              lat:        Number(row.lat),
              lng:        Number(row.lng),
              speed:      row.speed    != null ? Number(row.speed)    : null,
              heading:    row.heading  != null ? Number(row.heading)  : null,
              accuracy:   row.accuracy != null ? Number(row.accuracy) : null,
              altitude:   row.altitude != null ? Number(row.altitude) : null,
              updated_at: String(row.updated_at ?? ''),
            };
          }),
        );
      } catch (e: unknown) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    void fetchRows();
  }, [bookingId]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const trail    = rows.map(r => [r.lat, r.lng] as [number, number]);
  const startPos = rows.length ? trail[0] : null;
  const endPos   = rows.length > 1 ? trail[trail.length - 1] : null;
  const stats    = computeStats(rows);

  // ── GPX download ─────────────────────────────────────────────────────────
  const downloadGpx = () => {
    if (!rows.length) return;
    const gpx  = buildGpx(rows, bookingId);
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `farmdirect-trip-${bookingId.slice(-8)}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (!supabase) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
        <p className="font-bold">Supabase Not Configured</p>
        <p className="text-sm text-gray-500 mt-1">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 max-w-2xl flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-green-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="font-bold text-gray-900 text-sm">Location History</h1>
          <button
            type="button"
            onClick={downloadGpx}
            disabled={!rows.length}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-green-700 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> GPX
          </button>
        </div>
      </div>

      <div className="container mx-auto px-4 max-w-2xl py-6 space-y-4">

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-green-700" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-2 text-red-700 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* No data */}
        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-16">
            <MapPin className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="font-semibold text-gray-700">No location data recorded</p>
            <p className="text-sm text-gray-400 mt-1">
              Location points are recorded when the owner enables GPS broadcasting.
            </p>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <>
            {/* Map */}
            <div
              className="h-72 rounded-2xl overflow-hidden border border-gray-200 shadow-sm touch-none"
            >
              <DynamicMap
                trail={trail}
                startPos={startPos}
                endPos={endPos}
              />
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-gray-600 px-1">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-600 border-2 border-white shadow" />
                Start
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow" />
                End
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-6 h-0.5 bg-blue-500 rounded" />
                Path
              </span>
            </div>

            {/* Stats grid */}
            {stats && (
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={<Route className="h-4 w-4 text-blue-500" />}
                  label="Total Distance"
                  value={
                    stats.totalDistKm >= 1
                      ? `${stats.totalDistKm.toFixed(2)} km`
                      : `${(stats.totalDistKm * 1000).toFixed(0)} m`
                  }
                />
                <StatCard
                  icon={<Gauge className="h-4 w-4 text-green-500" />}
                  label="Avg. Speed"
                  value={
                    stats.avgSpeedKmh != null
                      ? `${stats.avgSpeedKmh.toFixed(1)} km/h`
                      : '—'
                  }
                />
                <StatCard
                  icon={<Clock className="h-4 w-4 text-purple-500" />}
                  label="Duration"
                  value={formatDuration(stats.durationMs)}
                />
                <StatCard
                  icon={<Navigation className="h-4 w-4 text-orange-500" />}
                  label="Points Recorded"
                  value={String(stats.pointCount)}
                />
              </div>
            )}

            {/* Timeline — first / last point */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
              <h2 className="font-bold text-gray-900 text-sm">Journey Timeline</h2>
              <TimelineItem
                color="bg-green-500"
                label="Started"
                time={rows[0].updated_at}
                coords={[rows[0].lat, rows[0].lng]}
              />
              {rows.length > 1 && (
                <TimelineItem
                  color="bg-red-500"
                  label="Last Recorded"
                  time={rows[rows.length - 1].updated_at}
                  coords={[rows[rows.length - 1].lat, rows[rows.length - 1].lng]}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value,
}: {
  icon: ReactNode; label: string; value: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold">{label}</span>
      </div>
      <p className="text-2xl font-black text-gray-900">{value}</p>
    </div>
  );
}

function TimelineItem({
  color, label, time, coords,
}: {
  color: string; label: string; time: string; coords: [number, number];
}) {
  const d = new Date(time);
  return (
    <div className="flex items-start gap-3">
      <span className={`w-3 h-3 rounded-full mt-0.5 shrink-0 ${color}`} />
      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-500">
          {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{' '}
          {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-xs text-gray-400 font-mono mt-0.5">
          {coords[0].toFixed(5)}, {coords[1].toFixed(5)}
        </p>
      </div>
    </div>
  );
}
