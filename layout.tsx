import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Business Ledger — owner workspace",
  description: "A private, multi-business operations and accounting workspace.",
  applicationName: "Business Ledger",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/branding/app-icon.svg",
    apple: "/branding/app-icon.svg",
  },
  appleWebApp: { capable: true, title: "Business Ledger", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#13243d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
