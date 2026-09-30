import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { Toaster } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import ApiHealthPing from "@/components/ApiHealthPing";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LanguageModal } from "@/components/LanguageSwitcher";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "FarmRent — Farm Equipment Rental",
  description: "Rent farm machinery directly from local owners. Tractors, harvesters, tillers and more.",
  keywords: "farm equipment rental, tractor rental, harvester rental, agri machinery India",
  openGraph: {
    title: "FarmRent — Farm Equipment Rental",
    description: "India's #1 agri-equipment marketplace. Rent tractors, harvesters & more near you.",
    type: "website",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Lets Android offer "Add to Home Screen" and iOS launch it chrome-free.
  appleWebApp: { capable: true, title: "FarmRent", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available on purpose — capping it locks out anyone who needs to magnify.
  maximumScale: 5,
  userScalable: true,
  themeColor: "#2E7D32",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <LanguageProvider>
          <AuthProvider>
            <LanguageModal />
            <ApiHealthPing />
            <Navbar />
            <main>
              <ErrorBoundary section="Page">
                {children}
              </ErrorBoundary>
            </main>
            <Footer />
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
