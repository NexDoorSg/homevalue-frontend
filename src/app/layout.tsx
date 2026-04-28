import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";

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
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '947297821608514');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=947297821608514&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        {children}
      </body>
    </html>
  );
}
