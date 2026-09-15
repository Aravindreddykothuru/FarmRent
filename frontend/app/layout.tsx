import './globals.css';
import React from 'react';

export const metadata = {
  title: 'FarmRent - Agricultural Equipment Rental Marketplace',
  description: 'Rent and manage modern farming equipment online easily.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
