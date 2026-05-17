import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface LocationData {
  lat:       number;
  lng:       number;
  speed?:    number | null;
  heading?:  number | null;
  accuracy?: number | null;
  timestamp?: string;
}

interface UseTrackingSocketResult {
  currentLocation: LocationData | null;
  isConnected:     boolean;
}

function trackingSocketOrigin(): string {
  const u = (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    ''
  ).replace(/\/$/, '');
  if (u) return u;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

export function useTrackingSocket(deliveryId: string): UseTrackingSocketResult {
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [isConnected,     setIsConnected]     = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!deliveryId) return;

    socketRef.current = io(`${trackingSocketOrigin()}/tracking`, {
      reconnectionAttempts: 5,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join_delivery_room', deliveryId);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('location_update', (data: LocationData) => {
      setCurrentLocation(data);
    });

    return () => {
      socket.emit('leave_delivery_room', deliveryId);
      socket.disconnect();
    };
  }, [deliveryId]);

  return { currentLocation, isConnected };
}
