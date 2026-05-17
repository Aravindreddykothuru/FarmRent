// This route is superseded by /forgot-password. Kept for backwards compatibility with any bookmarked URLs.
import { redirect } from 'next/navigation';

export default function PasswordResetRedirect() {
    redirect('/forgot-password');
}
