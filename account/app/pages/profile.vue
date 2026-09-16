<script setup lang="ts">
usePageTitle('个人资料')

const toast = useToast()
const colorMode = useColorMode()

interface Profile {
  id: number
  uid: string
  email: string
  real_name: string | null
  nickname: string | null
  avatar: string | null
  mobile: string | null
  position: string | null
  status: number
  synced_at: string | null
  department: {
    id: number
    name: string
    dept_code: string
  } | null
  roles: Array<{
    id: number
    role_code: string
    role_name: string
  }>
}

interface ApiResponse<T> {
  code?: number
  message?: string
  data: T
}

// Fetch profile
const { data: profileData, pending, refresh } = await useFetch<ApiResponse<Profile>>('/api/profile')
const profile = computed<Profile | null>(() => profileData.value?.data || null)

// Edit state
const isEditing = ref(false)
const saving = ref(false)
const editForm = reactive({
  nickname: '',
  mobile: '',
  position: ''
})

// Avatar upload
const avatarInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

console.log(profile.value)
// Avatar URL from OSS proxy (if available)
const authAvatar = useCookie<string | null>('auth_avatar', { path: '/', sameSite: 'lax' })

function normalizeAvatarPath(value: string | null | undefined) {
  if (!value) return null
  const v = String(value).trim()
  if (!v) return null
  // 完整 URL 直接返回
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  // OSS 路径取文件名
  return v.split('/').pop() || null
}

const avatarUrl = computed(() => {
  const avatar = normalizeAvatarPath(profile.value?.avatar) || normalizeAvatarPath(authAvatar.value)
  if (!avatar) return null
  if (avatar.startsWith('http://') || avatar.startsWith('https://')) return avatar
  return `/api/oss/avatar?path=${encodeURIComponent(avatar)}`
})

// Computed values
const displayName = computed(() =>
  profile.value?.nickname || profile.value?.real_name || profile.value?.uid || ''
)

const avatarLetter = computed(() => {
  if (!displayName.value) return '?'
  return displayName.value.charAt(0).toUpperCase()
})

const avatarColors = computed(() => {
  const colorPalettes = [
    { bg: '#dbeafe', text: '#2563eb', bgDark: '#1e3a8a', textDark: '#93c5fd' },
    { bg: '#dcfce7', text: '#16a34a', bgDark: '#14532d', textDark: '#86efac' },
    { bg: '#fef3c7', text: '#d97706', bgDark: '#78350f', textDark: '#fcd34d' },
    { bg: '#fce7f3', text: '#db2777', bgDark: '#831843', textDark: '#f9a8d4' },
    { bg: '#f3e8ff', text: '#9333ea', bgDark: '#581c87', textDark: '#d8b4fe' }
  ]
  const str = profile.value?.email || 'default'
  const index = str.charCodeAt(0) % colorPalettes.length
  return colorPalettes[index]
})

// Start editing
function startEdit() {
  if (profile.value) {
    editForm.nickname = profile.value.nickname || ''
    editForm.mobile = profile.value.mobile || ''
    editForm.position = profile.value.position || ''
  }
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
}

// Save profile
async function saveProfile() {
  saving.value = true
  try {
    await $fetch('/api/profile', {
      method: 'PATCH',
      body: editForm
    })
    toast.add({ title: '保存成功', color: 'success' })
    isEditing.value = false
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

// Trigger avatar upload
function triggerAvatarUpload() {
  avatarInput.value?.click()
}

// Handle avatar file selection
async function handleAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  if (!file) return

  // Validate
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    toast.add({ title: '格式不支持', description: '请上传 JPG、PNG、GIF 或 WebP 格式', color: 'error' })
    return
  }

  if (file.size > 5 * 1024 * 1024) {
    toast.add({ title: '文件过大', description: '图片大小不能超过 5MB', color: 'error' })
    return
  }

  uploading.value = true

  try {
    const formData = new FormData()
    formData.append('avatar', file)

    await $fetch('/api/profile/avatar', {
      method: 'POST',
      body: formData
    })

    toast.add({ title: '头像上传成功', color: 'success' })
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '上传失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    uploading.value = false
    // Reset input
    input.value = ''
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <div class="p-4 md:p-6">
        <div v-if="pending" class="flex items-center justify-center py-20">
          <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
        </div>

        <div v-else-if="profile" class="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          <!-- Left Column: Profile Content -->
          <div class="lg:col-span-2 space-y-6">
            <!-- Profile Header -->
            <UCard>
              <div class="flex items-start gap-6">
                <!-- Avatar -->
                <div class="relative group">
                  <div
                    v-if="avatarUrl"
                    class="w-20 h-20 rounded-full overflow-hidden cursor-pointer"
                    @click="triggerAvatarUpload"
                  >
                    <img :src="avatarUrl" :alt="displayName" class="w-full h-full object-cover">
                  </div>
                  <div
                    v-else
                    class="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold cursor-pointer"
                    :style="{
                      backgroundColor: colorMode.value === 'dark' ? avatarColors?.bgDark ?? '#1e3a8a' : avatarColors?.bg ?? '#dbeafe',
                      color: colorMode.value === 'dark' ? avatarColors?.textDark ?? '#93c5fd' : avatarColors?.text ?? '#2563eb'
                    }"
                    @click="triggerAvatarUpload"
                  >
                    {{ avatarLetter }}
                  </div>

                  <!-- Upload overlay -->
                  <div
                    class="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    @click="triggerAvatarUpload"
                  >
                    <UIcon v-if="!uploading" name="i-lucide-camera" class="w-6 h-6 text-white" />
                    <UIcon
                      v-else
                      name="i-lucide-loader-2"
                      class="w-6 h-6 text-white animate-spin"
                    />
                  </div>

                  <input
                    ref="avatarInput"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    class="hidden"
                    @change="handleAvatarChange"
                  >
                </div>

                <!-- Basic Info -->
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <h2 class="text-xl font-semibold">
                      {{ displayName }}
                    </h2>
                    <UBadge
                      v-for="role in profile.roles"
                      :key="role.id"
                      color="primary"
                      variant="subtle"
                      size="sm"
                    >
                      {{ role.role_name }}
                    </UBadge>
                  </div>
                  <p class="text-gray-500 mb-1">
                    <UIcon name="i-lucide-mail" class="inline w-4 h-4 mr-1" />
                    {{ profile.email }}
                  </p>
                  <p v-if="profile.department" class="text-gray-500">
                    <UIcon name="i-lucide-building-2" class="inline w-4 h-4 mr-1" />
                    {{ profile.department.name }}
                  </p>
                </div>

                <!-- Actions -->
                <div class="flex gap-2">
                  <template v-if="!isEditing">
                    <UButton
                      icon="i-lucide-pencil"
                      label="编辑"
                      color="primary"
                      variant="soft"
                      size="sm"
                      @click="startEdit"
                    />
                  </template>
                  <template v-else>
                    <UButton
                      icon="i-lucide-x"
                      label="取消"
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      @click="cancelEdit"
                    />
                    <UButton
                      icon="i-lucide-check"
                      label="保存"
                      color="primary"
                      size="sm"
                      :loading="saving"
                      @click="saveProfile"
                    />
                  </template>
                </div>
              </div>
            </UCard>

            <!-- Editable Info -->
            <UCard>
              <template #header>
                <h3 class="font-semibold">
                  基本信息
                </h3>
              </template>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Uid/LDAP UID (readonly) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">用户名</label>
                  <p class="text-base font-mono">
                    {{ profile.uid }}
                  </p>
                </div>

                <!-- Real Name (readonly from LDAP) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">真实姓名</label>
                  <p class="text-base">
                    {{ profile.real_name || '-' }}
                  </p>
                </div>

                <!-- Nickname (editable) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">昵称</label>
                  <template v-if="isEditing">
                    <UInput v-model="editForm.nickname" placeholder="输入昵称" />
                  </template>
                  <template v-else>
                    <p class="text-base">
                      {{ profile.nickname || '-' }}
                    </p>
                  </template>
                </div>

                <!-- Email (readonly) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">邮箱</label>
                  <p class="text-base">
                    {{ profile.email }}
                  </p>
                </div>

                <!-- Mobile (editable) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">手机号</label>
                  <template v-if="isEditing">
                    <UInput v-model="editForm.mobile" placeholder="输入手机号" />
                  </template>
                  <template v-else>
                    <p class="text-base">
                      {{ profile.mobile || '-' }}
                    </p>
                  </template>
                </div>

                <!-- Position (editable) -->
                <div>
                  <label class="block text-sm text-gray-500 mb-1">职位</label>
                  <template v-if="isEditing">
                    <UInput v-model="editForm.position" placeholder="输入职位" />
                  </template>
                  <template v-else>
                    <p class="text-base">
                      {{ profile.position || '-' }}
                    </p>
                  </template>
                </div>
              </div>
            </UCard>

            <!-- Account Info (readonly) -->
            <UCard>
              <template #header>
                <h3 class="font-semibold">
                  账户信息
                </h3>
              </template>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label class="block text-sm text-gray-500 mb-1">账户状态</label>
                  <UBadge :color="profile.status === 1 ? 'success' : 'neutral'" variant="subtle">
                    {{ profile.status === 1 ? '正常' : '禁用' }}
                  </UBadge>
                </div>

                <div>
                  <label class="block text-sm text-gray-500 mb-1">最后同步时间</label>
                  <p class="text-base">
                    {{ formatDate(profile.synced_at) }}
                  </p>
                </div>
              </div>
            </UCard>
          </div>

          <!-- Right Column: Tips & Sidebar -->
          <div class="lg:col-span-1">
            <div class="sticky top-6 space-y-4">
              <!-- Tip -->
              <div
                class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800"
              >
                <div class="flex items-start gap-2 mb-2">
                  <UIcon name="i-lucide-info" class="text-blue-500 mt-0.5 shrink-0" />
                  <h4 class="font-medium text-blue-700 dark:text-blue-300">
                    温馨提示
                  </h4>
                </div>
                <div class="text-sm text-blue-600 dark:text-blue-400 space-y-2">
                  <p>• 点击头像可以上传新的头像图片。</p>
                  <p>• 真实姓名、邮箱等基础信息从企业 LDAP 同步，如需修改请联系管理员。</p>
                  <p>• 完善个人资料有助于同事更好地认识你。</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="flex flex-col items-center justify-center py-20 text-gray-500">
          <UIcon name="i-lucide-user-x" class="w-12 h-12 mb-4" />
          <p>无法加载用户资料</p>
        </div>
      </div>
    </UDashboardPanel>
  </div>
</template>
