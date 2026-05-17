/**
 * lib/supabase.ts — Browser-side Supabase client (public/anon key).
 * Admin/server operations use the service key via the Node.js backend.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '';
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (typeof window !== 'undefined' && (!supabaseUrl || !supabaseAnon)) {
    /* Supabase features disabled in this environment */
}

export const supabase = supabaseUrl && supabaseAnon
    ? createClient(supabaseUrl, supabaseAnon, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 10 } },
    })
    : null;

export default supabase;

export type Database = {
    public: {
        Tables: {
            users: {
                Row: {
                    id: string;
                    name: string;
                    phone: string | null;
                    email: string;
                    role: 'farmer' | 'owner';
                    village: string | null;
                    town: string | null;
                    pincode: string | null;
                    state: string | null;
                    created_at: string;
                };
            };
            equipment: {
                Row: {
                    id: string;
                    owner_id: string;
                    name: string;
                    category: string;
                    description: string | null;
                    price_per_day: number;
                    availability_status: boolean;
                    pincode: string | null;
                    town: string | null;
                    village: string | null;
                    latitude: number | null;
                    longitude: number | null;
                    images: string[];
                    // GPS pickup location (added in Phase 1 migration)
                    pickup_lat:      number | null;
                    pickup_lng:      number | null;
                    pickup_address:  string | null;
                    pickup_landmark: string | null;
                    created_at: string;
                };
            };
            bookings: {
                Row: {
                    id: string;
                    equipment_id: string;
                    farmer_id: string;
                    owner_id: string;
                    start_date: string;
                    end_date: string;
                    total_price: number;
                    status: 'pending' | 'confirmed' | 'in_progress' | 'active' | 'returned' | 'cancelled' | 'completed';
                    payment_status: string;
                    created_at: string;
                };
            };
            chats: {
                Row: {
                    id: string;
                    booking_id: string | null;
                    equipment_id: string;
                    farmer_id: string;
                    owner_id: string;
                    created_at: string;
                };
            };
            messages: {
                Row: {
                    id: string;
                    chat_id: string;
                    sender_id: string;
                    content: string;
                    message_type: 'text' | 'image';
                    is_read: boolean;
                    created_at: string;
                };
            };
            reviews: {
                Row: {
                    id: string;
                    equipment_id: string;
                    reviewer_id: string;
                    rating: number;
                    comment: string | null;
                    created_at: string;
                };
            };
            notifications: {
                Row: {
                    id: string;
                    user_id: string;
                    title: string;
                    body: string;
                    type: string;
                    is_read: boolean;
                    created_at: string;
                };
            };
            equipment_tracking: {
                Row: {
                    id: string;
                    equipment_id: string;
                    lat: number;
                    lng: number;
                    timestamp: string;
                };
            };
            // Live GPS tracking (Phase 1 migration)
            equipment_locations: {
                Row: {
                    id:            string;
                    equipment_id:  string;
                    booking_id:    string;
                    lat:           number;
                    lng:           number;
                    accuracy:      number | null;
                    speed:         number | null;   // km/h
                    heading:       number | null;   // degrees
                    altitude:      number | null;   // metres
                    source:        'mobile_gps' | 'vehicle_gps';
                    device_id:     string | null;
                    battery_level: number | null;
                    updated_at:    string;
                    created_at:    string;
                };
                Insert: {
                    equipment_id:  string;
                    booking_id:    string;
                    lat:           number;
                    lng:           number;
                    accuracy?:     number | null;
                    speed?:        number | null;
                    heading?:      number | null;
                    altitude?:     number | null;
                    source?:       'mobile_gps' | 'vehicle_gps';
                    device_id?:    string | null;
                    battery_level?: number | null;
                };
            };
        };
    };
};
