/**
 * 样式预设系统 - 基于 Nuxt UI Landing Template
 * 从官方模板 https://github.com/nuxt-ui-templates/landing 提取样式模式
 */

export interface StylePreset {
  id: string
  name: string
  description: string
  
  // Hero 区域样式
  hero: {
    layout: 'centered' | 'split' | 'background'
    titleSize: 'default' | 'large' | 'xl'
    spacing: 'compact' | 'default' | 'spacious'
    background: 'default' | 'gradient' | 'pattern'
  }
  
  // Section 区域样式
  section: {
    layout: 'vertical' | 'horizontal' | 'card-grid'
    featureStyle: 'list' | 'card' | 'timeline'
    borderStyle: 'left' | 'all' | 'none'
    spacing: 'compact' | 'default' | 'spacious'
    animation: 'none' | 'fade' | 'slide'
  }
  
  // Features 区域样式
  features: {
    layout: 'grid' | 'masonry' | 'carousel'
    cardStyle: 'elevated' | 'flat' | 'outlined'
    iconStyle: 'filled' | 'outlined' | 'colorful'
    columns: 2 | 3 | 4
  }
  
  // Steps 区域样式
  steps: {
    layout: 'horizontal' | 'vertical' | 'timeline'
    numberStyle: 'circle' | 'square' | 'badge'
    imagePosition: 'top' | 'left' | 'right'
    connector: 'line' | 'arrow' | 'none'
  }
  
  // Pricing 区域样式
  pricing: {
    layout: 'side-by-side' | 'stacked' | 'comparison'
    cardStyle: 'elevated' | 'outlined' | 'gradient'
    highlight: 'border' | 'shadow' | 'color'
    features: 'list' | 'checkmarks' | 'icons'
  }
  
  // Testimonials 区域样式
  testimonials: {
    layout: 'masonry' | 'grid' | 'carousel'
    cardStyle: 'quote' | 'card' | 'minimal'
    avatarStyle: 'round' | 'square' | 'none'
    columns: 1 | 2 | 3
  }
  
  // CTA 区域样式
  cta: {
    style: 'centered' | 'split' | 'card'
    background: 'default' | 'primary' | 'gradient'
    buttonStyle: 'solid' | 'outlined' | 'gradient'
    spacing: 'compact' | 'default' | 'spacious'
  }
  
  // 全局颜色方案
  colors: {
    primary: string
    neutral: string
    accent?: string
  }
  
  // 全局字体设置
  typography: {
    headingFont: 'default' | 'serif' | 'display'
    bodyFont: 'default' | 'serif' | 'mono'
    scale: 'small' | 'default' | 'large'
  }
}

// 预定义样式
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'modern-minimal',
    name: '现代简约',
    description: '简洁现代的设计风格，注重内容和可读性',
    hero: {
      layout: 'centered',
      titleSize: 'large',
      spacing: 'default',
      background: 'default'
    },
    section: {
      layout: 'horizontal',
      featureStyle: 'list',
      borderStyle: 'left',
      spacing: 'default',
      animation: 'fade'
    },
    features: {
      layout: 'grid',
      cardStyle: 'elevated',
      iconStyle: 'filled',
      columns: 3
    },
    steps: {
      layout: 'horizontal',
      numberStyle: 'circle',
      imagePosition: 'top',
      connector: 'none'
    },
    pricing: {
      layout: 'side-by-side',
      cardStyle: 'outlined',
      highlight: 'border',
      features: 'checkmarks'
    },
    testimonials: {
      layout: 'masonry',
      cardStyle: 'quote',
      avatarStyle: 'round',
      columns: 3
    },
    cta: {
      style: 'centered',
      background: 'default',
      buttonStyle: 'solid',
      spacing: 'default'
    },
    colors: {
      primary: 'blue',
      neutral: 'slate'
    },
    typography: {
      headingFont: 'default',
      bodyFont: 'default',
      scale: 'default'
    }
  },
  
  {
    id: 'business-pro',
    name: '商务专业',
    description: '专业的商务风格，适合企业和服务类网站',
    hero: {
      layout: 'split',
      titleSize: 'default',
      spacing: 'spacious',
      background: 'gradient'
    },
    section: {
      layout: 'horizontal',
      featureStyle: 'card',
      borderStyle: 'all',
      spacing: 'spacious',
      animation: 'slide'
    },
    features: {
      layout: 'grid',
      cardStyle: 'elevated',
      iconStyle: 'colorful',
      columns: 3
    },
    steps: {
      layout: 'timeline',
      numberStyle: 'badge',
      imagePosition: 'left',
      connector: 'line'
    },
    pricing: {
      layout: 'comparison',
      cardStyle: 'elevated',
      highlight: 'shadow',
      features: 'icons'
    },
    testimonials: {
      layout: 'grid',
      cardStyle: 'card',
      avatarStyle: 'round',
      columns: 2
    },
    cta: {
      style: 'card',
      background: 'primary',
      buttonStyle: 'outlined',
      spacing: 'spacious'
    },
    colors: {
      primary: 'indigo',
      neutral: 'gray',
      accent: 'emerald'
    },
    typography: {
      headingFont: 'display',
      bodyFont: 'default',
      scale: 'default'
    }
  },
  
  {
    id: 'creative-bold',
    name: '创意大胆',
    description: '富有创意的大胆设计，适合创意和设计类网站',
    hero: {
      layout: 'background',
      titleSize: 'xl',
      spacing: 'spacious',
      background: 'pattern'
    },
    section: {
      layout: 'vertical',
      featureStyle: 'timeline',
      borderStyle: 'left',
      spacing: 'spacious',
      animation: 'slide'
    },
    features: {
      layout: 'masonry',
      cardStyle: 'flat',
      iconStyle: 'outlined',
      columns: 4
    },
    steps: {
      layout: 'vertical',
      numberStyle: 'square',
      imagePosition: 'right',
      connector: 'arrow'
    },
    pricing: {
      layout: 'stacked',
      cardStyle: 'gradient',
      highlight: 'color',
      features: 'list'
    },
    testimonials: {
      layout: 'carousel',
      cardStyle: 'minimal',
      avatarStyle: 'square',
      columns: 1
    },
    cta: {
      style: 'split',
      background: 'gradient',
      buttonStyle: 'gradient',
      spacing: 'compact'
    },
    colors: {
      primary: 'purple',
      neutral: 'zinc',
      accent: 'pink'
    },
    typography: {
      headingFont: 'serif',
      bodyFont: 'default',
      scale: 'large'
    }
  }
]

// 样式类映射
export const STYLE_CLASSES = {
  section: {
    featureStyle: {
      list: {
        container: 'space-y-6',
        item: 'border-l-2 pl-8 pt-4',
        primary: 'border-primary',
        secondary: 'border-default/50'
      },
      card: {
        container: 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3',
        item: 'p-6 rounded-lg border bg-card',
        primary: 'border-primary bg-primary/5',
        secondary: 'border-default'
      },
      timeline: {
        container: 'space-y-8',
        item: 'relative pl-8 border-l-2',
        primary: 'border-primary',
        secondary: 'border-default/50'
      }
    },
    layout: {
      vertical: 'space-y-8',
      horizontal: 'grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-start',
      'card-grid': 'grid gap-8 sm:grid-cols-2 lg:grid-cols-3'
    },
    spacing: {
      compact: 'py-12 sm:py-16',
      default: 'py-16 sm:py-24 lg:py-32',
      spacious: 'py-24 sm:py-32 lg:py-40'
    }
  },
  
  features: {
    layout: {
      grid: 'grid gap-8 sm:grid-cols-2 lg:grid-cols-3',
      masonry: 'columns-1 md:columns-2 lg:columns-3 gap-8 space-y-8',
      carousel: 'flex gap-8 overflow-x-auto pb-4'
    },
    cardStyle: {
      elevated: 'bg-card shadow-lg rounded-lg p-6',
      flat: 'bg-card rounded-lg p-6',
      outlined: 'bg-card border border-default rounded-lg p-6'
    },
    iconStyle: {
      filled: 'bg-primary p-2 rounded-md',
      outlined: 'border-2 border-primary p-2 rounded-md',
      colorful: 'bg-gradient-to-br from-primary to-primary/60 p-2 rounded-md'
    }
  },
  
  typography: {
    headingFont: {
      default: 'font-sans',
      serif: 'font-serif',
      display: 'font-display'
    },
    bodyFont: {
      default: 'font-sans',
      serif: 'font-serif',
      mono: 'font-mono'
    },
    scale: {
      small: 'text-sm',
      default: 'text-base',
      large: 'text-lg'
    }
  }
}

// 获取当前样式预设
export function getStylePreset(presetId: string): StylePreset | null {
  return STYLE_PRESETS.find(preset => preset.id === presetId) || null
}

// 获取样式类
export function getStyleClasses(preset: StylePreset, section: string, property: string): string {
  const sectionClasses = STYLE_CLASSES[section as keyof typeof STYLE_CLASSES]
  if (!sectionClasses) return ''
  
  const propertyClasses = sectionClasses[property as keyof typeof sectionClasses]
  if (!propertyClasses) return ''
  
  const presetValue = preset[section as keyof StylePreset]
  if (!presetValue || typeof presetValue !== 'object') return ''
  
  const value = presetValue[property as keyof typeof presetValue]
  if (!value) return ''
  
  if (typeof propertyClasses === 'object') {
    return propertyClasses[value as keyof typeof propertyClasses] || ''
  }
  
  return propertyClasses
}
