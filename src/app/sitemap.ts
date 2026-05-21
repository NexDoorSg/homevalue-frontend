import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    {
      url: 'https://homevalue.nexdoor.sg',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://homevalue.nexdoor.sg/free-property-valuation-singapore',
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ]
}
