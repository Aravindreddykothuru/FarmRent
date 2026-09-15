/**
 * mapColors.ts — Centralized design tokens for map overlays and GPS signals.
 * Since Leaflet's L.divIcon templates render raw HTML strings, they cannot
 * dynamically read Tailwind classes or CSS variables. This module provides
 * a single source of truth for all map-based semantic hex colors.
 */

export const MAP_COLORS = {
  // Pin Gradients
  PIN_GREEN_START:     '#16a34a',
  PIN_GREEN_END:       '#15803d',
  PIN_BLUE_START:      '#3b82f6',
  PIN_BLUE_END:        '#1d4ed8',
  PIN_AMBER_START:     '#f59e0b',
  PIN_AMBER_END:       '#d97706',
  PIN_RED_START:       '#ef4444',
  PIN_RED_END:         '#b91c1c',

  // Connection & Signal Indicators
  SIGNAL_LIVE:         '#16a34a',
  SIGNAL_WAITING:      '#f59e0b',
  SIGNAL_DISCONNECTED: '#ef4444',
  SIGNAL_LOST:         '#9ca3af',
  SIGNAL_CONNECTING:   '#2563eb',

  // Map Polyline Overlays
  ROUTE_LINE:          '#16a34a',
  BREADCRUMB_LINE:     '#6b7280',
  PATH_LINE:           '#3b82f6',
};
