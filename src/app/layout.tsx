import type { Metadata } from "next";
import { Geist_Mono, Montserrat, Playfair_Display } from "next/font/google";
import "./globals.css";
import "./homevalue-visual-fixes.css";
import Script from "next/script";
import HomeValueLeadPopupExperiment from "@/components/HomeValueLeadPopupExperiment";
import HomeValueAreaUnitSelector from "@/components/HomeValueAreaUnitSelector";
import HomeValueAddressQualityGuard from "@/components/HomeValueAddressQualityGuard";
import HomeValueBrandSections from "@/components/HomeValueBrandSections";
import HomeValueSeoSupportNav from "@/components/HomeValueSeoSupportNav";

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

const homeValueTitle =
  "Free Property Valuation Singapore | Check HDB, Condo, EC & Landed Home Value | NexDoor";
const homeValueDescription =
  "Get a free property valuation estimate in Singapore using recent HDB and URA transaction data. Check your HDB, condo, EC or landed home value before selling, buying, upgrading or refinancing.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.nexdoor.sg/#organization",
      name: "NexDoor",
      url: "https://www.nexdoor.sg",
      slogan: "Property Decisions, Made With Precision.",
      areaServed: "Singapore",
    },
    {
      "@type": "WebSite",
      "@id": "https://homevalue.nexdoor.sg/#website",
      name: "HomeValue by NexDoor",
      url: "https://homevalue.nexdoor.sg",
      publisher: {
        "@id": "https://www.nexdoor.sg/#organization",
      },
      inLanguage: "en-SG",
    },
    {
      "@type": "WebApplication",
      "@id": "https://homevalue.nexdoor.sg/#webapplication",
      name: "HomeValue by NexDoor",
      url: "https://homevalue.nexdoor.sg",
      applicationCategory: "BusinessApplication",
      operatingSystem: "All",
      description: homeValueDescription,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "SGD",
      },
      publisher: {
        "@id": "https://www.nexdoor.sg/#organization",
      },
      areaServed: "Singapore",
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://homevalue.nexdoor.sg"),
  title: homeValueTitle,
  description: homeValueDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: homeValueTitle,
    description: homeValueDescription,
    url: "https://homevalue.nexdoor.sg",
    siteName: "HomeValue by NexDoor",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: homeValueTitle,
    description: homeValueDescription,
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
        <Script id="homevalue-structured-data" type="application/ld+json">
          {JSON.stringify(jsonLd)}
        </Script>
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
        <HomeValueSeoSupportNav />
        <HomeValueBrandSections />
      </body>
    </html>
  );
}
