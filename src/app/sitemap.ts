import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://homevalue.nexdoor.sg'

  const routes = [
    '',
    '/free-property-valuation-singapore',
    '/how-much-is-my-property-worth-singapore',
    '/how-property-valuation-works-singapore',
    '/hdb-valuation-singapore',
    '/condo-valuation-singapore',
    '/landed-valuation-singapore',
    '/hdb-valuation-ang-mo-kio',
    '/hdb-valuation-bedok',
    '/hdb-valuation-bishan',
    '/hdb-valuation-jurong-west',
    '/hdb-valuation-punggol',
    '/hdb-valuation-sengkang',
    '/hdb-valuation-tampines',
    '/hdb-valuation-woodlands',
    '/hdb-valuation-yishun',
  ]

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: route === '' ? 1 : 0.8,
  }))
}
