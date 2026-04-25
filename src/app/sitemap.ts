import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://homevalue.nexdoor.sg'

  const routes = [
    '',
    '/free-property-valuation-singapore',
    '/hdb-valuation-singapore',
    '/condo-valuation-singapore',
    '/landed-valuation-singapore',
    '/hdb-valuation-tampines',
    '/hdb-valuation-jurong-west',
    '/hdb-valuation-woodlands',
    '/hdb-valuation-yishun',
    '/hdb-valuation-bedok',
    '/hdb-valuation-punggol',
    '/hdb-valuation-ang-mo-kio',
  ]

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: route === '' ? 1 : 0.8,
  }))
}
