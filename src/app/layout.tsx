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

const siteUrl = "https://homevalue.nexdoor.sg";
const nexDoorUrl = "https://www.nexdoor.sg";
const homeValueTitle =
  "Free Property Valuation Singapore | Check HDB, Condo, EC & Landed Home Value | NexDoor";
const homeValueDescription =
  "Get a free property valuation estimate in Singapore using recent HDB and URA transaction data. Check your HDB, condo, EC or landed home value before selling, buying, upgrading or refinancing.";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["Organization", "LocalBusiness", "RealEstateAgent"],
      "@id": `${nexDoorUrl}/#organization`,
      name: "NexDoor",
      alternateName: "NexDoor | Singapore Property Agency",
      legalName: "NEXDOOR PTE. LTD.",
      url: nexDoorUrl,
      logo: `${nexDoorUrl}/logo.png`,
      image: `${nexDoorUrl}/logo.png`,
      description:
        "NexDoor is a Singapore property agency offering data-backed advice for HDB, condo, EC and landed property decisions.",
      telephone: "+65 8988 2212",
      email: "admin@nexdoor.sg",
      slogan: "Property Decisions, Made With Precision.",
      address: {
        "@type": "PostalAddress",
        streetAddress: "152 Beach Road, #23-02, Gateway East",
        postalCode: "189721",
        addressLocality: "Singapore",
        addressCountry: "SG",
      },
      areaServed: {
        "@type": "Country",
        name: "Singapore",
      },
      identifier: [
        {
          "@type": "PropertyValue",
          propertyID: "Singapore UEN",
          value: "202606966C",
        },
        {
          "@type": "PropertyValue",
          propertyID: "CEA Estate Agent Licence",
          value: "L3011052H",
        },
      ],
      knowsAbout: [
        "Singapore property valuation",
        "HDB valuation",
        "Condo valuation",
        "Executive condominium valuation",
        "Landed property valuation",
        "HDB resale transactions",
        "URA private property transactions",
        "Singapore residential property",
      ],
      sameAs: [
        siteUrl,
        "https://www.google.com/maps/place/NexDoor/@1.2988735,103.8568258,17z/data=!3m1!4b1!4m6!3m5!1s0xf62bf4168a9c009:0xa0a9d337a6b0a905!8m2!3d1.2988735!4d103.8594007!16s%2Fg%2F11n9srb1lm",
        "https://www.instagram.com/nexdoorsingapore/",
        "https://www.tiktok.com/@nexdoorsingapore",
        "https://www.facebook.com/nexdoorsingapore",
        "https://www.youtube.com/@NexDoorSG",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      name: "HomeValue by NexDoor",
      url: siteUrl,
      description: homeValueDescription,
      publisher: {
        "@id": `${nexDoorUrl}/#organization`,
      },
      inLanguage: "en-SG",
    },
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}/#webapplication`,
      name: "HomeValue by NexDoor",
      alternateName: "NexDoor HomeValue",
      url: siteUrl,
      applicationCategory: "BusinessApplication",
      operatingSystem: "All",
      description: homeValueDescription,
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "SGD",
      },
      publisher: {
        "@id": `${nexDoorUrl}/#organization`,
      },
      areaServed: {
        "@type": "Country",
        name: "Singapore",
      },
      about: [
        "Free property valuation Singapore",
        "HDB home value estimate",
        "Condo valuation Singapore",
        "EC valuation Singapore",
        "Landed property valuation Singapore",
      ],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: homeValueTitle,
  description: homeValueDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: homeValueTitle,
    description: homeValueDescription,
    url: siteUrl,
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
      lang="en-SG"
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
