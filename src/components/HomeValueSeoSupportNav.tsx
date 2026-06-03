"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const seoPageRoutes = new Set([
  "/free-property-valuation-singapore",
  "/hdb-valuation-singapore",
  "/condo-valuation-singapore",
  "/landed-valuation-singapore",
  "/how-property-valuation-works-singapore",
  "/how-much-is-my-property-worth-singapore",
  "/hdb-valuation-ang-mo-kio",
  "/hdb-valuation-bedok",
  "/hdb-valuation-bishan",
  "/hdb-valuation-jurong-west",
  "/hdb-valuation-punggol",
  "/hdb-valuation-sengkang",
  "/hdb-valuation-tampines",
  "/hdb-valuation-woodlands",
  "/hdb-valuation-yishun",
]);

const mainLinks = [
  { href: "/", label: "Check your property value" },
  { href: "/free-property-valuation-singapore", label: "Free property valuation" },
  { href: "/hdb-valuation-singapore", label: "HDB valuation" },
  { href: "/condo-valuation-singapore", label: "Condo valuation" },
  { href: "/landed-valuation-singapore", label: "Landed valuation" },
  { href: "/how-property-valuation-works-singapore", label: "How valuation works" },
];

const hdbTownLinks = [
  { href: "/hdb-valuation-ang-mo-kio", label: "Ang Mo Kio" },
  { href: "/hdb-valuation-bedok", label: "Bedok" },
  { href: "/hdb-valuation-bishan", label: "Bishan" },
  { href: "/hdb-valuation-jurong-west", label: "Jurong West" },
  { href: "/hdb-valuation-punggol", label: "Punggol" },
  { href: "/hdb-valuation-sengkang", label: "Sengkang" },
  { href: "/hdb-valuation-tampines", label: "Tampines" },
  { href: "/hdb-valuation-woodlands", label: "Woodlands" },
  { href: "/hdb-valuation-yishun", label: "Yishun" },
];

function LinkPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-[#17243a] bg-[#17243a] text-[#fffdf8]"
          : "border-[#d8c7ad] bg-[#fffdf8] text-[#17243a] hover:border-[#a9894f] hover:text-[#87692d]"
      }`}
    >
      {label}
    </Link>
  );
}

export default function HomeValueSeoSupportNav() {
  const pathname = usePathname();
  const isSeoPage = seoPageRoutes.has(pathname);

  if (!isSeoPage) {
    return null;
  }

  const isHdbTownPage = pathname.startsWith("/hdb-valuation-") && pathname !== "/hdb-valuation-singapore";

  return (
    <section className="bg-[#fbf7ef] px-6 py-12 md:px-10">
      <div className="mx-auto max-w-[1040px] rounded-[28px] border border-[#d8c7ad] bg-[#fffdf8] p-6 shadow-[0_20px_60px_rgba(23,36,58,0.06)] sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a9894f]">
          HomeValue guide
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[#17243a] sm:text-3xl">
          Continue with the main HomeValue tool
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#71695d] sm:text-base">
          These guide pages help explain different parts of property valuation in Singapore.
          To get an indicative estimate for your own home, start from the main HomeValue
          valuation pages and enter your property details there.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {mainLinks.map((link) => (
            <LinkPill key={link.href} href={link.href} label={link.label} active={pathname === link.href} />
          ))}
        </div>

        {isHdbTownPage ? (
          <div className="mt-8 border-t border-[#d8c7ad] pt-6">
            <p className="text-sm font-semibold text-[#17243a]">Other HDB town guides</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {hdbTownLinks.map((link) => (
                <LinkPill key={link.href} href={link.href} label={link.label} active={pathname === link.href} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
