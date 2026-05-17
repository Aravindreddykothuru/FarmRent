import type { Metadata } from "next";
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
