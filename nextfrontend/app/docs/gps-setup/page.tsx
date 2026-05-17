/**
 * /docs/gps-setup — Setup guide for hardware SIM-based GPS trackers.
 * Static page — no auth required.
 */

export const metadata = { title: 'GPS Device Setup | FarmDirect' };

export default function GpsSetupPage() {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') ??
    'https://your-app.vercel.app';

  const endpoint = `${baseUrl}/api/tracking/update`;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4 max-w-2xl">

        <h1 className="text-3xl font-black text-gray-900 mb-2">
          🛰️ Hardware GPS Tracker Setup
        </h1>
        <p className="text-gray-500 mb-8">
          Configure a SIM-based vehicle GPS tracker to push live location to FarmDirect.
        </p>

        {/* Step 1 */}
        <Section title="Step 1: Get Your Credentials">
          <p className="text-sm text-gray-700 mb-3">
            Contact your FarmDirect admin or check your <code className="bg-gray-100 px-1 rounded">.env</code> file for:
          </p>
          <CodeBlock>{`TRACKING_DEVICE_SECRET=your-secret-here
# Ask your admin for this value — never share it publicly.`}</CodeBlock>
        </Section>

        {/* Step 2 */}
        <Section title="Step 2: Find Your Booking & Equipment IDs">
          <p className="text-sm text-gray-700 mb-3">
            On your dashboard, open the active booking. The URL will look like:
          </p>
          <CodeBlock>{`/dashboard/track/{booking_id}
# The long UUID in the URL is your booking_id.
# The equipment_id is visible in the booking details card.`}</CodeBlock>
        </Section>

        {/* Step 3 */}
        <Section title="Step 3: Configure Your GPS Tracker">
          <p className="text-sm text-gray-700 mb-3">
            Most SIM GPS trackers (e.g. Concox, Teltonika, Queclink) support
            HTTP POST payloads. Point your device to:
          </p>
          <CodeBlock>{endpoint}</CodeBlock>
          <p className="text-sm text-gray-700 mt-3 mb-2">
            Configure the following HTTP request:
          </p>
          <CodeBlock>{`Method: POST
URL: ${endpoint}

Headers:
  Content-Type: application/json
  x-device-secret: YOUR_DEVICE_SECRET

Body (JSON):
{
  "device_id":    "DEVICE001",
  "equipment_id": "uuid-of-equipment",
  "booking_id":   "uuid-of-booking",
  "lat":          12.9716,
  "lng":          77.5946,
  "speed":        15.5,
  "heading":      180.0,
  "altitude":     920.0,
  "timestamp":    "2025-01-01T10:00:00Z"
}`}</CodeBlock>
        </Section>

        {/* Step 4 */}
        <Section title="Step 4: Response Format">
          <p className="text-sm text-gray-700 mb-2">
            On success the endpoint returns:
          </p>
          <CodeBlock>{`HTTP 200
{ "success": true, "received_at": "2025-01-01T10:00:01Z" }`}</CodeBlock>
          <p className="text-sm text-gray-700 mt-3 mb-2">Common error codes:</p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left p-2 border border-gray-200">HTTP Code</th>
                <th className="text-left p-2 border border-gray-200">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['401', 'Wrong or missing x-device-secret header'],
                ['400', 'Invalid or missing required fields'],
                ['404', 'Booking ID not found'],
                ['422', 'Booking is not in an active status'],
                ['429', 'Rate limit — sending too fast (max 1/10 sec per device)'],
                ['500', 'Server error — contact support'],
              ].map(([code, msg]) => (
                <tr key={code} className="border-b border-gray-100">
                  <td className="p-2 border border-gray-200 font-mono">{code}</td>
                  <td className="p-2 border border-gray-200 text-gray-600">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Rate limit note */}
        <Section title="Rate Limit">
          <p className="text-sm text-gray-700">
            The API accepts at most <strong>1 request per 10 seconds per device_id</strong>.
            Configure your tracker's upload interval to 10–30 seconds for optimal battery and data usage.
          </p>
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-green-700 text-white text-xs flex items-center justify-center font-black shrink-0">
          {title.split(':')[0].replace('Step ', '')}
        </span>
        {title.split(':').slice(1).join(':').trim()}
      </h2>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
      {children}
    </pre>
  );
}
