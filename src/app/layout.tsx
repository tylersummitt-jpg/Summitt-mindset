// src/app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { ReactNode } from "react";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Summitt Leadership",
  description: "Pat Summitt–inspired leadership, mindset, and coaching platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="flex flex-col min-h-screen">
          <Navbar />
          <main className="flex-1">{children}</main>
          <footer className="border-t bg-white">
            <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-gray-500 flex justify-between">
              <span>© {new Date().getFullYear()} Summitt Leadership</span>
              <span>Inspired by Pat Summitt&apos;s Definite Dozen</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
