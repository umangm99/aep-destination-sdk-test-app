import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "./components/Sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AEP Destination SDK Test",
  description: "Dashboard for AEP Custom Destination testing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar />
          <main style={{ 
            flex: 1, 
            marginLeft: "var(--sidebar-width)",
            padding: "40px",
            minHeight: "100vh",
            position: "relative"
          }}>
            {/* Ambient background glow */}
            <div style={{
              position: "fixed",
              top: "-20%",
              right: "-10%",
              width: "50%",
              height: "50%",
              background: "radial-gradient(circle, rgba(59,130,246,0.08) 0%, rgba(0,0,0,0) 70%)",
              pointerEvents: "none",
              zIndex: -1
            }} />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
