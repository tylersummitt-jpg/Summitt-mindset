import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summitt Leadership",
  description: "Pat Summitt-inspired leadership, mindset, and coaching platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}>
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
        </ClerkProvider>
      </body>
    </html>
  );
}
