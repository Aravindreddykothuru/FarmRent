// The public address of the site, without a trailing slash.
//
// NEXT_PUBLIC_APP_URL is compiled in when the image is built, and a build that is not handed it gets an empty
// string rather than nothing — so the fallback has to cover "empty" as well as "unset".
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://farmrentcom.in').replace(/\/+$/, '');
