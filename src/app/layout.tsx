import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://homevalue.nexdoor.sg"),
  title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
  description:
    "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
    description:
      "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
    url: "https://homevalue.nexdoor.sg",
    siteName: "HomeValue by NexDoor",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
    description:
      "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
  },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
