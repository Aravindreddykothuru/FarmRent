/**
 * One source of truth for the support details shown to users.
 *
 * These appear in the footer and on the auth screens' "Need help?" button; keeping them
 * here stops the two copies drifting apart the next time the number changes.
 */
export const SUPPORT_PHONE_DISPLAY = '+91 76719 97693';

/** tel: links need the number unpunctuated, or Android dialers mangle it. */
export const SUPPORT_PHONE_E164 = '+917671997693';

export const SUPPORT_EMAIL = 'support@farmrent.in';

export const SUPPORT_LOCATION = 'Tirupathi, Andhra Pradesh, India';
