import type { Metadata } from "next";
import TowerView from "@/components/TowerView";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const projectName = decodeURIComponent(slug || "").trim();
  const title = `${projectName} Tower View | HomeValue by NexDoor`;
  const description = `Explore ${projectName} unit-by-unit: per-stack transaction history, profitability and Seller's Stamp Duty status across the tower.`;
  return {
    title,
    description,
    alternates: { canonical: `/projects/${slug}/tower` },
    openGraph: {
      title,
      description,
      url: `https://homevalue.nexdoor.sg/projects/${slug}/tower`,
      siteName: "HomeValue by NexDoor",
      locale: "en_SG",
      type: "website",
    },
  };
}

export default async function TowerPage({ params }: PageProps) {
  const { slug } = await params;
  return <TowerView slug={slug} />;
}
