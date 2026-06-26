<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
  header?: boolean
}>()

const colorMode = useColorMode()
const appConfig = useAppConfig() as {
  ui: {
    colors: {
      primary: string
      neutral: string
    }
  }
}
const pub = (useRuntimeConfig().public || {}) as Record<string, unknown>
const currentAppCode = String(pub.appCode || pub.appName || '')

interface AccountProfileResponse {
  data: {
    uid: string
    email: string
    real_name: string | null
    nickname: string | null
    avatar: string | null
  } | null
}

type UserMenuRoleOption = {
  roleCode: string
  roleName?: string | null
}

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

const auth = useAuth()
const { user: authUser, userEmail: authEmail, userRealname: authRealname, userAvatar, logout } = auth
const toast = useToast()
const { activeRoleCode, setActiveRoleCode } = useActiveRole()
const { loadAuthorization, getAuthorization } = useAuthorization()
const { cookieOptions } = useCookieOptions()
const opts = cookieOptions()
const authRealName = useCookie<string | null>('auth_real_name', opts)
const realName = useCookie<string | null>('real_name', opts)
const avatarLoadFailed = ref(false)
const darkAvatarDataUrl = ref<string | null>(null)
const fetchedAccountUser = ref<{
  uid: string
  email: string
  realName: string | null
  avatar: string | null
} | null>(null)
const cachedAvailableRoles = ref<UserMenuRoleOption[]>([])
const switchingRoleCode = ref('')
watch(() => `${String(authUser?.value || '').trim()}|${String(auth.tenant?.value || '').trim()}`, (identity, previousIdentity) => {
  if (previousIdentity !== undefined && identity !== previousIdentity) {
    cachedAvailableRoles.value = []
  }
})
const { data: accountProfileData } = await useFetch<AccountProfileResponse | null>('/api/profile', {
  immediate: currentAppCode === 'account',
  server: false,
  default: () => null
})
const accountProfile = computed(() => accountProfileData.value?.data || null)
const accountFallbackUser = computed(() => {
  return fetchedAccountUser.value
})
const authorization = computed(() => getAuthorization())
const availableRoles = computed<UserMenuRoleOption[]>(() => {
  return (authorization.value?.availableRoles || []) as UserMenuRoleOption[]
})
watch(availableRoles, (roles) => {
  if (roles.length) {
    cachedAvailableRoles.value = roles
  }
}, { immediate: true })
const roleOptions = computed<UserMenuRoleOption[]>(() => availableRoles.value.length ? availableRoles.value : cachedAvailableRoles.value)
const currentRoleCode = computed(() => {
  const preferredRoleCode = String(activeRoleCode.value || '').trim()
  if (preferredRoleCode && roleOptions.value.some(role => role.roleCode === preferredRoleCode)) {
    return preferredRoleCode
  }

  const authorizationRoleCode = String(authorization.value?.activeRoleCode || '').trim()
  if (authorizationRoleCode && roleOptions.value.some(role => role.roleCode === authorizationRoleCode)) {
    return authorizationRoleCode
  }

  return roleOptions.value[0]?.roleCode || ''
})
const hasMultipleRoles = computed(() => roleOptions.value.length > 1)
const activeRole = computed(() => {
  return roleOptions.value.find(role => role.roleCode === currentRoleCode.value) || null
})

watch(() => String(authUser?.value || '').trim(), (uid) => {
  fetchedAccountUser.value = null
  if (!uid || currentAppCode === 'account') return
  $fetch<{ code?: number, data?: { uid: string, email: string, realName: string | null, avatar: string | null } }>(
    `/api/directory/users/${encodeURIComponent(uid)}`
  ).then((response) => {
    if (response?.code === 0 && response.data) {
      fetchedAccountUser.value = response.data
    }
  }).catch(() => {})
}, { immediate: true })

onMounted(() => {
  void loadAuthorization()
})

function getChipColor(item: unknown) {
  if (!item || typeof item !== 'object') return '#737373'
  const chip = (item as { chip?: string }).chip
  return colorMap[chip || '']?.light || '#737373'
}

function normalizeAvatarPath(value: string | null | undefined) {
  if (!value) return null
  const avatar = String(value).trim()
  if (!avatar) return null
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar
  return avatar.split('/').pop() || null
}

function roleText(role: { roleCode: string, roleName?: string | null }) {
  return String(role.roleName || role.roleCode || '').trim()
}

async function switchActiveRole(roleCode: string) {
  const nextRoleCode = String(roleCode || '').trim()
  if (!nextRoleCode || nextRoleCode === currentRoleCode.value || switchingRoleCode.value) return

  switchingRoleCode.value = nextRoleCode

  try {
    setActiveRoleCode(nextRoleCode)
    const snapshot = getAuthorization()
    if (snapshot && roleOptions.value.some(role => role.roleCode === nextRoleCode)) {
      snapshot.activeRoleCode = nextRoleCode
    }

    const role = roleOptions.value.find(item => item.roleCode === nextRoleCode)
    toast.add({
      title: '已选择企业角色',
      description: role ? `${roleText(role)} · ${role.roleCode}` : nextRoleCode,
      color: 'success'
    })
  } finally {
    switchingRoleCode.value = ''
  }
}

const preferredRealName = computed(() => {
  return accountProfile.value?.real_name
    || accountFallbackUser.value?.realName
    || authRealName.value
    || authRealname?.value
    || realName.value
    || ''
})

const avatarUrl = computed(() => {
  return resolveAvatarSrc(
    normalizeAvatarPath(accountProfile.value?.avatar)
    || accountFallbackUser.value?.avatar
    || normalizeAvatarPath(userAvatar?.value as string | null)
  ) || null
})

watch(avatarUrl, () => {
  avatarLoadFailed.value = false
  darkAvatarDataUrl.value = null
})

const displayedAvatarUrl = computed(() => {
  if (colorMode.value === 'dark' && darkAvatarDataUrl.value) return darkAvatarDataUrl.value
  return avatarUrl.value
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
  const email = user.value.email || accountProfile.value?.email || authEmail?.value || ''
  return email ? email.charAt(0).toUpperCase() : '?'
})

const avatarColors = computed(() => {
  const email = user.value.email || accountProfile.value?.email || authEmail?.value || ''
  if (!email) return avatarColorPalettes[0]
  const index = email.charCodeAt(0) % avatarColorPalettes.length
  return avatarColorPalettes[index]
})

function isNearWhitePixel(data: Uint8ClampedArray) {
  const red = data[0] ?? 0
  const green = data[1] ?? 0
  const blue = data[2] ?? 0
  const alpha = data[3] ?? 0
  return alpha > 245 && red > 245 && green > 245 && blue > 245
}

function isNearWhitePixelAt(data: Uint8ClampedArray, offset: number) {
  const red = data[offset] ?? 0
  const green = data[offset + 1] ?? 0
  const blue = data[offset + 2] ?? 0
  const alpha = data[offset + 3] ?? 0
  return alpha > 245 && red > 245 && green > 245 && blue > 245
}

function inspectAvatarImage(event: Event) {
  const image = event.target
  if (!(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) {
    darkAvatarDataUrl.value = null
    return
  }
  if (image.currentSrc.startsWith('data:')) return

  try {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight))
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const maxX = canvas.width - 1
    const maxY = canvas.height - 1
    const samplePoints: Array<[number, number]> = [
      [0, 0],
      [maxX, 0],
      [0, maxY],
      [maxX, maxY],
      [Math.round(maxX / 2), 0],
      [Math.round(maxX / 2), maxY],
      [0, Math.round(maxY / 2)],
      [maxX, Math.round(maxY / 2)]
    ]
    const whiteSamples = samplePoints.filter(([x, y]) => isNearWhitePixel(context.getImageData(x, y, 1, 1).data)).length
    if (whiteSamples < 6) {
      darkAvatarDataUrl.value = null
      return
    }

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const visited = new Uint8Array(canvas.width * canvas.height)
    const queue: number[] = []

    const isNearWhiteAt = (index: number) => {
      return isNearWhitePixelAt(pixels, index * 4)
    }
    const enqueue = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
      const index = y * canvas.width + x
      if (visited[index]) return
      if (!isNearWhiteAt(index)) return
      visited[index] = 1
      queue.push(index)
    }

    for (let x = 0; x < canvas.width; x += 1) {
      enqueue(x, 0)
      enqueue(x, maxY)
    }
    for (let y = 1; y < maxY; y += 1) {
      enqueue(0, y)
      enqueue(maxX, y)
    }

    let removedPixels = 0
    while (queue.length) {
      const index = queue.pop()
      if (typeof index !== 'number') continue
      const offset = index * 4
      pixels[offset + 3] = 0
      removedPixels += 1
      const x = index % canvas.width
      const y = Math.floor(index / canvas.width)
      enqueue(x + 1, y)
      enqueue(x - 1, y)
      enqueue(x, y + 1)
      enqueue(x, y - 1)
    }

    if (removedPixels < canvas.width * canvas.height * 0.08) {
      darkAvatarDataUrl.value = null
      return
    }

    context.putImageData(imageData, 0, 0)
    darkAvatarDataUrl.value = canvas.toDataURL('image/png')
  } catch {
    darkAvatarDataUrl.value = null
  }
}

watchEffect(() => {
  if (preferredRealName.value) {
    user.value.name = preferredRealName.value
  } else if (accountProfile.value?.nickname) {
    user.value.name = accountProfile.value.nickname
  } else if (authUser?.value && typeof authUser.value === 'string') {
    user.value.name = authUser.value
  }
  if (accountProfile.value?.email) {
    user.value.email = accountProfile.value.email
  } else if (accountFallbackUser.value?.email) {
    user.value.email = accountFallbackUser.value.email
  } else if (authEmail?.value) {
    user.value.email = authEmail.value
  }
})

const currentRoleLabel = computed(() => {
  return activeRole.value ? roleText(activeRole.value) : '企业角色'
})

const roleSwitchItems = computed<DropdownMenuItem[]>(() => {
  if (!hasMultipleRoles.value) return []

  return roleOptions.value.map(role => ({
    label: roleText(role),
    description: role.roleCode,
    icon: 'i-lucide-shield',
    type: 'checkbox',
    disabled: Boolean(switchingRoleCode.value),
    checked: role.roleCode === currentRoleCode.value,
    async onSelect() {
      await switchActiveRole(role.roleCode)
    }
  }))
})

const items = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [[{
    type: 'label',
    label: user.value.name,
    slot: 'user-label'
  }], [{
    label: '个人资料',
    icon: 'i-lucide-user',
    to: '/settings/profile'
  }]]

  groups.push([{
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
  }])

  groups.push([{
    label: '退出登录',
    icon: 'i-lucide-log-out',
    async onSelect(e: Event) {
      e.preventDefault()
      await logout()
    }
  }])

  return groups
})
</script>

<template>
  <div
    :class="[
      'flex min-w-0 items-center',
      header ? 'gap-1.5' : 'w-full gap-2',
      collapsed ? 'justify-center' : ''
    ]"
  >
    <UDropdownMenu
      v-if="hasMultipleRoles && !collapsed"
      :items="roleSwitchItems"
      :content="{ align: 'end', collisionPadding: 12 }"
      :ui="{ content: 'w-52' }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        :loading="Boolean(switchingRoleCode)"
        :class="[
          'h-8 min-w-0 px-1 text-xs data-[state=open]:bg-elevated',
          header ? 'max-w-[8.5rem] sm:max-w-[10rem]' : 'max-w-full flex-1'
        ]"
        :ui="{ leadingIcon: 'shrink-0', trailingIcon: 'shrink-0 text-dimmed' }"
      >
        <template #leading>
          <UIcon name="i-lucide-shield-user" class="size-4 shrink-0" />
        </template>
        <span class="min-w-0 truncate">{{ currentRoleLabel }}</span>
      </UButton>
    </UDropdownMenu>

    <UDropdownMenu
      :items="items"
      :content="{ align: 'center', collisionPadding: 12 }"
      :ui="{ content: collapsed ? 'w-36' : 'w-(--reka-dropdown-menu-trigger-width)' }"
    >
      <UButton
        color="neutral"
        variant="ghost"
        :block="!header"
        :square="collapsed"
        :class="[
          'data-[state=open]:bg-elevated',
          header ? 'h-8 px-1' : ''
        ]"
        :ui="{ trailingIcon: 'text-dimmed' }"
      >
        <template #leading>
          <ClientOnly>
            <img
              v-if="avatarUrl && !avatarLoadFailed"
              :src="displayedAvatarUrl || avatarUrl"
              alt="avatar"
              class="size-6 rounded-full bg-elevated object-cover shrink-0"
              @load="inspectAvatarImage"
              @error="avatarLoadFailed = true"
            >
            <div
              v-else
              class="size-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              :style="{
                backgroundColor: colorMode.value === 'dark' ? (avatarColors?.bgDark || '#1e3a8a') : (avatarColors?.bg || '#dbeafe'),
                color: colorMode.value === 'dark' ? (avatarColors?.textDark || '#93c5fd') : (avatarColors?.text || '#2563eb')
              }"
            >
              {{ avatarLetter }}
            </div>
            <template #fallback>
              <div class="size-6 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
            </template>
          </ClientOnly>
        </template>
      </UButton>

      <template #user-label>
        <div class="flex items-center gap-2 px-2 py-1.5">
          <ClientOnly>
            <img
              v-if="avatarUrl && !avatarLoadFailed"
              :src="displayedAvatarUrl || avatarUrl"
              alt="avatar"
              class="w-6 h-6 rounded-full bg-elevated object-cover shrink-0"
              @load="inspectAvatarImage"
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
              backgroundColor: getChipColor(item)
            }"
          />
        </div>
      </template>
    </UDropdownMenu>
  </div>
</template>
