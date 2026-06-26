import { h, type FunctionalComponent } from 'vue'

/**
 * Composable to convert SVG content or URL to a Vue icon component
 * for use with Nuxt UI components that accept `icon` prop
 */
export function useSvgIcon() {
  /**
   * Create an icon component from raw SVG string content
   * @param svgContent - Raw SVG string (e.g., '<svg>...</svg>')
   * @param size - Size in pixels (default: 24)
   */
  const fromSvgString = (svgContent: string, size = 24): FunctionalComponent => {
    return () => h('span', {
      class: 'inline-flex items-center justify-center',
      style: { width: `${size}px`, height: `${size}px` },
      innerHTML: svgContent
    })
  }

  /**
   * Create an icon component from an image URL (SVG, PNG, etc.)
   * @param url - Image URL
   * @param alt - Alt text
   * @param size - Size in pixels (default: 24)
   */
  const fromUrl = (url: string, alt = '', size = 24): FunctionalComponent => {
    return () => h('img', {
      src: url,
      alt,
      class: 'inline-block object-contain',
      style: { width: `${size}px`, height: `${size}px` }
    })
  }

  /**
   * Create an icon component from SVG path data
   * @param pathData - SVG path d attribute (e.g., 'M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8z')
   * @param viewBox - SVG viewBox (default: '0 0 24 24')
   * @param fill - Fill color (default: 'currentColor')
   */
  const fromPath = (pathData: string, viewBox = '0 0 24 24', fill = 'currentColor'): FunctionalComponent => {
    return () => h(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox,
        class: 'w-full h-full',
        fill: 'none'
      },
      [
        h('path', {
          fill,
          d: pathData
        })
      ]
    )
  }

  /**
   * Create an icon component for a business logo
   * Handles both URL-based logos and inline SVG
   * @param business - Business object with logo property
   * @param size - Size in pixels (default: 20)
   */
  const fromBusinessLogo = (business: { logo?: string, displayName?: string, name?: string } | null, size = 20): FunctionalComponent | undefined => {
    if (!business?.logo) return undefined

    const alt = business.displayName || business.name || 'Logo'

    // Check if it's a data URL with inline SVG
    if (business.logo.startsWith('data:image/svg+xml')) {
      // For data URLs, use img tag
      return fromUrl(business.logo, alt, size)
    }

    // For regular URLs (including R2 or other CDN URLs)
    return fromUrl(business.logo, alt, size)
  }

  return {
    fromSvgString,
    fromUrl,
    fromPath,
    fromBusinessLogo
  }
}
