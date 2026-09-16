<script setup lang="ts">
interface Props {
  businessName?: string
  logo?: string
  displayName?: string
  currentMode?: 'light' | 'dark'
  previewTheme?: {
    primary: string  // 十六进制颜色值，如 '#3b82f6'
    neutral: string  // 颜色名称，如 'slate', 'gray', 'zinc'
  }
  sections?: Array<{
    key: string
    name: string
    enabled: boolean
    showInNav: boolean
    displayName?: string
  }>
}

const props = withDefaults(defineProps<Props>(), {
  businessName: 'repoinsight',
  logo: '/logo.svg',
  displayName: 'repoinsight',
  currentMode: 'light'
})

// Emits for preview mode
const emit = defineEmits<{
  previewLinkClick: [url: string]
  previewModeChange: [mode: 'light' | 'dark']
}>()

// 预览模式直接由父组件传入（编辑器控制），本组件用于展示与发出切换事件
const previewMode = computed<'light' | 'dark'>(() => props.currentMode)

// Active section highlighting - 基于传入的sections动态生成
const navDefs = computed(() => {
  if (!props.sections) {
    // 默认的导航项
    return [
      { label: 'Home', id: 'hero' },
      { label: 'Features', id: 'features' },
      { label: 'Pricing', id: 'pricing' }
    ]
  }

  // 基于启用且显示在导航栏的章节生成导航项
  return props.sections
    .filter(section => section.enabled && section.showInNav)
    .map(section => ({
      label: section.displayName || section.name,
      id: section.key
    }))
})

const activeSectionId = ref<string>('hero')

// 导航项现在直接使用 navDefs，不需要额外的 items computed

// Handle button clicks in preview mode
const handleSignInClick = () => {
  emit('previewLinkClick', 'login')
}

const handleSignUpClick = () => {
  emit('previewLinkClick', 'signup')
}

// Toggle preview mode
const togglePreviewMode = () => {
  const next = previewMode.value === 'light' ? 'dark' : 'light'
  emit('previewModeChange', next)
}

// Handle navigation menu clicks
const handleNavClick = (url: string) => {
  if (url.startsWith('#')) {
    // Handle anchor links with smooth scrolling
    const targetId = url.substring(1)
    const targetElement = document.getElementById(targetId)

    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
      activeSectionId.value = targetId
    } else {
      console.warn(`Element with id "${targetId}" not found`)
    }
  } else {
    // Handle other links
    emit('previewLinkClick', url)
  }
}

// 简化后的实现：直接使用十六进制颜色值，不需要映射

// 计算动态样式
const headerThemeStyles = computed(() => {
  return {
    '--preview-primary': props.previewTheme?.primary || '#3b82f6'
  }
})

// 计算 Header 背景样式，并在组件本地作用域内提供必要的 UI 令牌，避免污染全局
const previewHeaderStyles = computed(() => {
  const getNeutralName = (value?: string) => {
    if (!value) return 'slate'
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return value
    if (value.startsWith('hsl(var(--color-') && value.endsWith('))')) {
      const inner = value.slice('hsl(var(--color-'.length, -2)
      return inner.split('-')[0]
    }
    return value
  }

  const neutralColorMap: Record<string, { light: string, dark: string, textDark: string, textLight: string }> = {
    slate: { light: '#f8fafc', dark: '#0f172a', textDark: '#f1f5f9', textLight: '#1e293b' },
    gray: { light: '#f9fafb', dark: '#111827', textDark: '#f3f4f6', textLight: '#374151' },
    zinc: { light: '#fafafa', dark: '#09090b', textDark: '#f4f4f5', textLight: '#3f3f46' },
    neutral: { light: '#fafafa', dark: '#0a0a0a', textDark: '#f5f5f5', textLight: '#404040' },
    stone: { light: '#fafaf9', dark: '#0c0a09', textDark: '#f5f5f4', textLight: '#44403c' }
  }

  const nn = getNeutralName(props.previewTheme?.neutral)
  const scheme = neutralColorMap[nn] || neutralColorMap.slate
  const isDark = (props.currentMode || 'light') === 'dark'
  const bg = isDark ? scheme.dark : scheme.light
  const fg = isDark ? scheme.textDark : scheme.textLight

  // 转换 hex 为 HSL 字符串供 Nuxt UI 语义变量使用
  const hexToHslString = (hex: string): string => {
    const clean = hex.replace('#', '')
    const isShort = clean.length === 3
    const r = parseInt(isShort ? clean[0] + clean[0] : clean.substring(0, 2), 16) / 255
    const g = parseInt(isShort ? clean[1] + clean[1] : clean.substring(2, 4), 16) / 255
    const b = parseInt(isShort ? clean[2] + clean[2] : clean.substring(4, 6), 16) / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    let s = 0
    const l = (max + min) / 2
    const d = max - min
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0)
          break
        case g:
          h = (b - r) / d + 2
          break
        default:
          h = (r - g) / d + 4
      }
      h /= 6
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
  }

  // 为该 Header 根元素提供一组局部令牌，供其内部 Nuxt UI 组件消费
  // 注意：这些变量仅在该元素作用域内生效，不会泄漏到预览区外部
  const styleVars: Record<string, string> = {
    '--background': hexToHslString(bg),
    '--card': hexToHslString(bg),
    '--foreground': hexToHslString(fg),
    '--border': isDark ? '240 3.7% 15.9%' : '240 5% 84%',
    '--ui-bg': bg,
    '--ui-bg-elevated': bg,
    '--color-primary-500': props.previewTheme?.primary || '#3b82f6',
    '--app-header-bg': bg,
    '--app-header-border': 'transparent',
    '--app-header-shadow': 'none',
    '--app-header-backdrop': 'none',
    '--preview-header-bg': bg,
    '--preview-header-fg': fg
  }

  return {
    background: bg,
    backgroundColor: bg,
    color: fg,
    ...styleVars
  }
})

const headerUi = computed(() => ({
  root: [
    'bg-blue-50 dark:bg-slate-900',
    'text-[var(--preview-header-fg)]',
    'border-transparent',
    'shadow-none',
    'backdrop-blur-none'
  ].join(' '),
  container: 'max-w-none px-4 sm:px-6 lg:px-8',
  left: 'gap-2',
  right: 'gap-2',
  toggle: 'text-[var(--preview-header-fg)] hover:bg-transparent focus-visible:bg-transparent'
}))

// 计算 Sign up 按钮的样式（使用内联样式应用主题色）
const signUpButtonStyle = computed(() => {
  return {
    backgroundColor: props.previewTheme?.primary || '#3b82f6',
    borderColor: props.previewTheme?.primary || '#3b82f6',
    color: 'white'
  }
})

// Observe sections within preview container to update active nav item
let observer: IntersectionObserver | null = null

const setupSectionObserver = () => {
  if (import.meta.server) return
  const container = document.querySelector('.preview-container') as HTMLElement | null
  if (!container) return

  const ids = navDefs.value.map(n => n.id)
  const options: IntersectionObserverInit = {
    root: container,
    // 当目标元素有 55% 在可视区域内就认为激活
    threshold: [0.55],
    // 顶部预留一点空间，避免标题栏遮挡影响判断
    rootMargin: '0px 0px -25% 0px'
  }

  observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
    if (visible[0]?.target?.id) {
      activeSectionId.value = visible[0].target.id
    }
  }, options)

  ids.forEach(id => {
    const el = container.querySelector(`#${id}`)
    if (el) observer!.observe(el)
  })
}

// 监听sections变化，重新设置observer
watch(() => props.sections, () => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  nextTick(() => {
    setupSectionObserver()
  })
}, { deep: true })

onMounted(() => {
  setupSectionObserver()
})

onBeforeUnmount(() => {
  if (observer) {
    observer.disconnect()
    observer = null
  }
})
</script>

<template>
  <UHeader :ui="headerUi" :style="{ ...headerThemeStyles, ...previewHeaderStyles }">
    <template #left>
      <div class="flex items-center gap-2 text-3xl font-bold">
        <!-- 租户信息 -->
        <img :src="logo" class="w-auto h-8 shrink-0" />
        <span>{{ displayName || businessName }}</span>
      </div>
    </template>

    <nav class="hidden md:flex items-center space-x-6">
      <template v-for="item in navDefs" :key="item.id">
        <button @click="handleNavClick(`#${item.id}`)" :class="[
          'text-base font-medium transition-colors hover:opacity-80',
          activeSectionId === item.id
            ? 'font-semibold'
            : 'text-muted-foreground'
        ]" :style="activeSectionId === item.id ? {
          color: props.previewTheme?.primary || '#3b82f6',
          fontWeight: '600'
        } : {}">
          {{ item.label }}
        </button>
      </template>
    </nav>

    <template #right>
      <div class="flex items-center gap-2">
        <UButton label="Sign in" color="neutral" variant="ghost" title="Sign in to your account"
          @click="handleSignInClick" />
        <UButton label="Sign up" :style="signUpButtonStyle" title="Create a new account" @click="handleSignUpClick" />
      </div>
      <!-- Custom Preview Dark/Light Mode Toggle -->
      <UButton @click="togglePreviewMode" variant="ghost" size="xs"
        :icon="previewMode === 'dark' ? 'i-heroicons-moon' : 'i-heroicons-sun'"
        :title="previewMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
        :class="previewMode === 'dark' ? 'text-white' : 'text-black'" />
    </template>

    <template #body>
      <nav class="flex flex-col space-y-3 -mx-2.5">
        <template v-for="item in navDefs" :key="item.id">
          <button @click="handleNavClick(`#${item.id}`)" :class="[
            'px-2.5 py-2 text-left text-base font-medium transition-colors hover:opacity-80 rounded-md',
            activeSectionId === item.id
              ? 'font-semibold bg-muted'
              : 'text-muted-foreground hover:bg-muted/50'
          ]" :style="activeSectionId === item.id ? {
            color: props.previewTheme?.primary || '#3b82f6',
            fontWeight: '600'
          } : {}">
            {{ item.label }}
          </button>
        </template>
      </nav>

      <USeparator class="my-6" />

      <UButton label="Sign in" color="neutral" variant="subtle" block class="mb-3" title="Sign in to your account"
        @click="handleSignInClick" />
      <UButton label="Sign up" :style="signUpButtonStyle" block title="Create a new account"
        @click="handleSignUpClick" />
    </template>
  </UHeader>
</template>
