import type { Metadata } from "next";
import { Geist_Mono, Montserrat, Playfair_Display } from "next/font/google";
import "./globals.css";
import "./homevalue-visual-fixes.css";
import Script from "next/script";
import HomeValueLeadPopupExperiment from "@/components/HomeValueLeadPopupExperiment";
import HomeValueAreaUnitSelector from "@/components/HomeValueAreaUnitSelector";
import HomeValueAddressQualityGuard from "@/components/HomeValueAddressQualityGuard";
import HomeValueBrandSections from "@/components/HomeValueBrandSections";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://homevalue.nexdoor.sg"),
  title: "Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor",
  description:
    "Get a free property value estimate in Singapore using recent HDB and URA transaction data. Check your HDB, condo, EC or landed home value before your next move.",
  openGraph: {
    title: "Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor",
    description:
      "Get a free property value estimate in Singapore using recent HDB and URA transaction data. Check your HDB, condo, EC or landed home value before your next move.",
    url: "https://homevalue.nexdoor.sg",
    siteName: "HomeValue by NexDoor",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Property Valuation Singapore | HDB, Condo, EC & Landed | NexDoor",
    description:
      "Get a free property value estimate in Singapore using recent HDB and URA transaction data. Check your HDB, condo, EC or landed home value before your next move.",
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
      className={`${montserrat.variable} ${playfair.variable} ${geistMono.variable} h-full antialiased`}
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
        <HomeValueLeadPopupExperiment />
        <HomeValueAreaUnitSelector />
        <HomeValueAddressQualityGuard />
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
        <HomeValueBrandSections />
      </body>
    </html>
  );
}
