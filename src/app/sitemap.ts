import type { MetadataRoute } from 'next'

const baseUrl = 'https://homevalue.nexdoor.sg'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const pages = [
  { route: '', changeFrequency: 'weekly', priority: 1 },
  { route: '/free-property-valuation-singapore', changeFrequency: 'weekly', priority: 0.95 },
  { route: '/hdb-valuation-singapore', changeFrequency: 'monthly', priority: 0.75 },
  { route: '/condo-valuation-singapore', changeFrequency: 'monthly', priority: 0.75 },
  { route: '/landed-valuation-singapore', changeFrequency: 'monthly', priority: 0.75 },
  { route: '/how-property-valuation-works-singapore', changeFrequency: 'monthly', priority: 0.7 },
  { route: '/how-much-is-my-property-worth-singapore', changeFrequency: 'monthly', priority: 0.7 },
  { route: '/hdb-valuation-ang-mo-kio', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-bedok', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-bishan', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-jurong-west', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-punggol', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-sengkang', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-tampines', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-woodlands', changeFrequency: 'monthly', priority: 0.6 },
  { route: '/hdb-valuation-yishun', changeFrequency: 'monthly', priority: 0.6 },
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return pages.map((page) => ({
    url: `${baseUrl}${page.route}`,
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))
}
