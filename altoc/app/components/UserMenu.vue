<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
  header?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const colorMode = useColorMode()
const appConfig = useAppConfig()

const colors = ['orange', 'amber', 'lime', 'emerald', 'teal', 'cyan', 'sky', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']
const neutrals = ['slate', 'gray', 'zinc', 'neutral', 'stone']

const colorMap: Record<string, { light: string, dark: string }> = {
  'orange': { light: '#f97316', dark: '#fb923c' },
  'amber': { light: '#f59e0b', dark: '#fbbf24' },
  'lime': { light: '#84cc16', dark: '#a3e635' },
  'emerald': { light: '#10b981', dark: '#34d399' },
  'teal': { light: '#14b8a6', dark: '#2dd4bf' },
  'cyan': { light: '#06b6d4', dark: '#22d3ee' },
  'sky': { light: '#0ea5e9', dark: '#38bdf8' },
  'indigo': { light: '#6366f1', dark: '#818cf8' },
  'violet': { light: '#8b5cf6', dark: '#a78bfa' },
  'purple': { light: '#a855f7', dark: '#c084fc' },
  'fuchsia': { light: '#d946ef', dark: '#e879f9' },
  'pink': { light: '#ec4899', dark: '#f472b6' },
  'rose': { light: '#f43f5e', dark: '#fb7185' },
  'slate': { light: '#64748b', dark: '#94a3b8' },
  'gray': { light: '#6b7280', dark: '#9ca3af' },
  'zinc': { light: '#71717a', dark: '#a1a1aa' },
  'neutral': { light: '#737373', dark: '#a3a3a3' },
  'stone': { light: '#78716c', dark: '#a8a29e' },
  'old-neutral': { light: '#737373', dark: '#a3a3a3' }
}

const user = ref({
  name: '未登录',
  email: ''
})

const { user: authUser, logout } = useAuth()
const authEmail = useCookie<string | null>('auth_email', { path: '/', sameSite: 'lax' })
const authRealName = useCookie<string | null>('auth_real_name', { path: '/', sameSite: 'lax' })
const authRealname = useCookie<string | null>('auth_realname', { path: '/', sameSite: 'lax' })
const realName = useCookie<string | null>('real_name', { path: '/', sameSite: 'lax' })
const authAvatar = useCookie<string | null>('auth_avatar', { path: '/', sameSite: 'lax' })
const avatarLoadFailed = ref(false)
const accountFallbackUser = ref<{
  uid: string
  email: string
  realName: string | null
  avatar: string | null
} | null>(null)

watch(() => String(authUser?.value || '').trim(), (uid) => {
  accountFallbackUser.value = null
  if (!uid) return
  $fetch<{ code?: number, data?: { uid: string, email: string, realName: string | null, avatar: string | null } }>(
    `/api/account/users/${encodeURIComponent(uid)}`
  ).then((response) => {
    if (response?.code === 0 && response.data) {
      accountFallbackUser.value = response.data
    }
  }).catch(() => {})
}, { immediate: true })

const preferredRealName = computed(() => {
  return accountFallbackUser.value?.realName || authRealName.value || authRealname.value || realName.value || ''
})

const avatarUrl = computed(() => {
  return resolveAvatarSrc(accountFallbackUser.value?.avatar || authAvatar.value) || null
})

watch(avatarUrl, () => {
  avatarLoadFailed.value = false
})

const avatarColorPalettes = [
  { bg: '#dbeafe', text: '#2563eb', bgDark: '#1e3a8a', textDark: '#93c5fd' },
  { bg: '#dcfce7', text: '#16a34a', bgDark: '#14532d', textDark: '#86efac' },
  { bg: '#fef3c7', text: '#d97706', bgDark: '#78350f', textDark: '#fcd34d' },
  { bg: '#fce7f3', text: '#db2777', bgDark: '#831843', textDark: '#f9a8d4' },
  { bg: '#f3e8ff', text: '#9333ea', bgDark: '#581c87', textDark: '#d8b4fe' }
]

const avatarLetter = computed(() => {
  const realname = preferredRealName.value
  if (realname) return realname.charAt(0).toUpperCase()
  const email = user.value.email || authEmail.value || ''
  return email ? email.charAt(0).toUpperCase() : '?'
})

const avatarColors = computed(() => {
  const email = user.value.email || authEmail.value || ''
  if (!email) return avatarColorPalettes[0]
  const index = email.charCodeAt(0) % avatarColorPalettes.length
  return avatarColorPalettes[index]
})

watchEffect(() => {
  if (preferredRealName.value) {
    user.value.name = preferredRealName.value
  } else if (authUser?.value && typeof authUser.value === 'string') {
    user.value.name = authUser.value
  }
  if (accountFallbackUser.value?.email) {
    user.value.email = accountFallbackUser.value.email
  } else if (authEmail.value) {
    user.value.email = authEmail.value
  }
})

const items = computed<DropdownMenuItem[][]>(() => ([[{
  type: 'label',
  label: user.value.name,
  slot: 'user-label'
}], [{
  label: '个人资料',
  icon: 'i-lucide-user',
  to: '/settings/profile'
}], [{
  label: '主题',
  icon: 'i-lucide-palette',
  children: [{
    label: '主色调',
    slot: 'chip',
    chip: appConfig.ui.colors.primary,
    content: {
      align: 'center',
      collisionPadding: 16
    },
    children: colors.map(color => ({
      label: color,
      chip: color,
      slot: 'chip',
      checked: appConfig.ui.colors.primary === color,
      type: 'checkbox',
      onSelect: (e) => {
        e.preventDefault()
        appConfig.ui.colors.primary = color
      }
    }))
  }, {
    label: '中性色',
    slot: 'chip',
    chip: appConfig.ui.colors.neutral === 'neutral' ? 'old-neutral' : appConfig.ui.colors.neutral,
    content: {
      align: 'end',
      collisionPadding: 16
    },
    children: neutrals.map(color => ({
      label: color,
      chip: color === 'neutral' ? 'old-neutral' : color,
      slot: 'chip',
      type: 'checkbox',
      checked: appConfig.ui.colors.neutral === color,
      onSelect: (e) => {
        e.preventDefault()
        appConfig.ui.colors.neutral = color
      }
    }))
  }]
}, {
  label: '外观',
  icon: 'i-lucide-sun-moon',
  children: [{
    label: '日间',
    icon: 'i-lucide-sun',
    type: 'checkbox',
    checked: colorMode.value === 'light',
    onSelect(e: Event) {
      e.preventDefault()
      colorMode.preference = 'light'
    }
  }, {
    label: '夜间',
    icon: 'i-lucide-moon',
    type: 'checkbox',
    checked: colorMode.value === 'dark',
    onUpdateChecked(checked: boolean) {
      if (checked) {
        colorMode.preference = 'dark'
      }
    },
    onSelect(e: Event) {
      e.preventDefault()
    }
  }]
}], [{
  label: '退出登录',
  icon: 'i-lucide-log-out',
  async onSelect(e: Event) {
    e.preventDefault()
    await logout()
  }
}]]))
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
    @update:open="emit('update:open', $event)"
  >
    <UButton
      color="neutral"
      variant="ghost"
      :block="!header"
      :square="collapsed"
      :class="[
        'data-[state=open]:bg-elevated',
        header ? 'h-9 px-1' : ''
      ]"
      :ui="{ trailingIcon: 'text-dimmed' }"
    >
      <template #leading>
        <ClientOnly>
          <img
            v-if="avatarUrl && !avatarLoadFailed"
            :src="avatarUrl"
            alt="avatar"
            class="w-6 h-6 rounded-full object-cover shrink-0"
            @error="avatarLoadFailed = true"
          >
          <div
            v-else
            class="w-8 h-8 rounded-full flex items-center justify-center text-md font-bold shrink-0"
            :style="{
              backgroundColor: colorMode.value === 'dark' ? (avatarColors?.bgDark || '#1e3a8a') : (avatarColors?.bg || '#dbeafe'),
              color: colorMode.value === 'dark' ? (avatarColors?.textDark || '#93c5fd') : (avatarColors?.text || '#2563eb')
            }"
          >
            {{ avatarLetter }}
          </div>
          <template #fallback>
            <div class="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
          </template>
        </ClientOnly>
      </template>
    </UButton>

    <template #user-label>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <ClientOnly>
          <img
            v-if="avatarUrl && !avatarLoadFailed"
            :src="avatarUrl"
            alt="avatar"
            class="w-6 h-6 rounded-full object-cover shrink-0"
            @error="avatarLoadFailed = true"
          >
          <div
            v-else
            class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            :style="{
              backgroundColor: colorMode.value === 'dark' ? (avatarColors?.bgDark || '#1e3a8a') : (avatarColors?.bg || '#dbeafe'),
              color: colorMode.value === 'dark' ? (avatarColors?.textDark || '#93c5fd') : (avatarColors?.text || '#2563eb')
            }"
          >
            {{ avatarLetter }}
          </div>
          <template #fallback>
            <div class="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
          </template>
        </ClientOnly>
        <span class="font-medium text-sm">{{ user.name }}</span>
      </div>
    </template>

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg size-2"
          :style="{
            backgroundColor: colorMap[(item as any).chip]?.light || '#737373'
          }"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
