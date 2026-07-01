import type { Metadata } from "next";
import ProjectDirectory from "@/components/ProjectDirectory";

const pageTitle = "Singapore Condo Project Directory | HomeValue by NexDoor";
const pageDescription =
  "Browse all private residential projects in Singapore. Filter condos, apartments and executive condominiums by district, market segment, tenure and rental, and view each project's historical PSF and unit profitability.";

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: "/projects",
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: "https://homevalue.nexdoor.sg/projects",
    siteName: "HomeValue by NexDoor",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

export default function ProjectsPage() {
  return <ProjectDirectory />;
}
