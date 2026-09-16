<script setup lang="ts">
const { apiBase } = useApiBase()
const toast = useToast()
const colorMode = useColorMode()

interface Profile {
  id: number
  email: string
  username: string | null
  mobile: string | null
  status: number
  remark: string | null
  roles: string[]
  umask: number
  personId: number | null
  personName: string | null
  departmentId: number | null
  departmentName: string | null
  latestLoggedAt: string | null
  loginIp: string | null
  createdAt: string
  updatedAt: string
}

const { data: profile, pending, refresh } = await useFetch<Profile>(`${apiBase}/profile`)

// Form state for editing
const isEditing = ref(false)
const editForm = reactive({
  username: '',
  mobile: '',
  remark: ''
})

// Password change state
const showPasswordModal = ref(false)
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const passwordLoading = ref(false)

// Get avatar letter from email
const avatarLetter = computed(() => {
  if (!profile.value?.email) return '?'
  return profile.value.email.charAt(0).toUpperCase()
})

// Generate avatar colors based on email
const avatarColors = computed(() => {
  if (!profile.value?.email) {
    return { bg: '#e0f2fe', text: '#0284c7', bgDark: '#0c4a6e', textDark: '#7dd3fc' }
  }
  const colorPalettes = [
    { bg: '#dbeafe', text: '#2563eb', bgDark: '#1e3a8a', textDark: '#93c5fd' }, // blue
    { bg: '#dcfce7', text: '#16a34a', bgDark: '#14532d', textDark: '#86efac' }, // green
    { bg: '#fef3c7', text: '#d97706', bgDark: '#78350f', textDark: '#fcd34d' }, // amber
    { bg: '#fce7f3', text: '#db2777', bgDark: '#831843', textDark: '#f9a8d4' }, // pink
    { bg: '#f3e8ff', text: '#9333ea', bgDark: '#581c87', textDark: '#d8b4fe' } // purple
  ]
  const index = profile.value.email.charCodeAt(0) % colorPalettes.length
  return colorPalettes[index]
})

// Role badge colors
function getRoleBadgeColor(role: string) {
  switch (role) {
    case '总经理': return 'primary'
    case '分管领导': return 'warning'
    case 'HR': return 'success'
    case '部门经理': return 'primary'
    default: return 'neutral'
  }
}

// Start editing
function startEdit() {
  if (profile.value) {
    editForm.username = profile.value.username || ''
    editForm.mobile = profile.value.mobile || ''
    editForm.remark = profile.value.remark || ''
  }
  isEditing.value = true
}

// Cancel editing
function cancelEdit() {
  isEditing.value = false
}

// Save profile changes
const saveLoading = ref(false)
async function saveProfile() {
  saveLoading.value = true
  try {
    await $fetch(`${apiBase}/profile`, {
      method: 'PATCH',
      body: {
        username: editForm.username || null,
        mobile: editForm.mobile || null,
        remark: editForm.remark || null
      }
    })
    toast.add({
      title: '保存成功',
      description: '个人资料已更新',
      color: 'success'
    })
    isEditing.value = false
    await refresh()
  } catch (error: any) {
    toast.add({
      title: '保存失败',
      description: error.data?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    saveLoading.value = false
  }
}

// Change password
async function changePassword() {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    toast.add({
      title: '密码不匹配',
      description: '两次输入的新密码不一致',
      color: 'error'
    })
    return
  }

  if (passwordForm.newPassword.length < 6) {
    toast.add({
      title: '密码太短',
      description: '密码长度不能少于6位',
      color: 'error'
    })
    return
  }

  passwordLoading.value = true
  try {
    await $fetch(`${apiBase}/profile/password`, {
      method: 'POST',
      body: {
        currentPassword: passwordForm.currentPassword || undefined,
        newPassword: passwordForm.newPassword
      }
    })
    toast.add({
      title: '密码修改成功',
      description: '您的密码已更新',
      color: 'success'
    })
    showPasswordModal.value = false
    passwordForm.currentPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
  } catch (error: any) {
    toast.add({
      title: '修改失败',
      description: error.data?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    passwordLoading.value = false
  }
}

// Format date
function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel
      id="profile"
      :ui="{ body: 'gap-4 sm:p-6' }"
    >
      <template #header>
        <UDashboardNavbar
          title="个人资料"
          :ui="{ root: 'h-12' }"
        >
          <template #leading>
            <UDashboardSidebarCollapse />
          </template>
          <template #right />
        </UDashboardNavbar>
      </template>

      <template #body>
        <div
          v-if="pending"
          class="flex items-center justify-center py-20"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-8 h-8 animate-spin text-primary"
          />
        </div>

        <div
          v-else-if="profile"
          class="w-full md:w-2/3 mx-auto space-y-6"
        >
          <!-- Profile Header Card -->
          <UCard>
            <div class="flex items-start gap-6">
              <!-- Avatar -->
              <div
                class="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold"
                :style="{
                  backgroundColor: colorMode.value === 'dark' ? (avatarColors?.bgDark ?? '#0c4a6e') : (avatarColors?.bg ?? '#e0f2fe'),
                  color: colorMode.value === 'dark' ? (avatarColors?.textDark ?? '#7dd3fc') : (avatarColors?.text ?? '#0284c7')
                }"
              >
                {{ avatarLetter }}
              </div>

              <!-- Basic Info -->
              <div class="flex-1">
                <div class="flex items-center gap-3 mb-2">
                  <h2 class="text-xl font-semibold">
                    {{ profile.username || (profile.email ? profile.email.split('@')[0] : '-') }}
                  </h2>
                  <UBadge
                    v-for="role in profile.roles"
                    :key="role"
                    :color="getRoleBadgeColor(role)"
                    variant="subtle"
                    size="sm"
                  >
                    {{ role }}
                  </UBadge>
                </div>
                <p class="text-muted-500 mb-1">
                  <UIcon
                    name="i-lucide-mail"
                    class="inline w-4 h-4 mr-1"
                  />
                  {{ profile.email }}
                </p>
                <p
                  v-if="profile.departmentName"
                  class="text-muted-500"
                >
                  <UIcon
                    name="i-lucide-building-2"
                    class="inline w-4 h-4 mr-1"
                  />
                  {{ profile.departmentName }}
                </p>
              </div>

              <!-- Actions -->
              <div>
                <UButton
                  v-if="!isEditing"
                  icon="i-lucide-pencil"
                  label="编辑资料"
                  color="primary"
                  variant="soft"
                  size="sm"
                  @click="startEdit"
                />
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
                    :loading="saveLoading"
                    @click="saveProfile"
                  />
                </template>
                <UButton
                  icon="i-lucide-key"
                  label="修改密码"
                  color="secondary"
                  variant="outline"
                  size="sm"
                  class="ml-2"
                  @click="showPasswordModal = true"
                />
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
              <!-- Username -->
              <div>
                <label class="block text-sm text-muted-500 mb-1">显示名称</label>
                <template v-if="isEditing">
                  <UInput
                    v-model="editForm.username"
                    placeholder="输入显示名称"
                  />
                </template>
                <template v-else>
                  <p class="text-base">
                    {{ profile.username || '-' }}
                  </p>
                </template>
              </div>

              <!-- Email (readonly) -->
              <div>
                <label class="block text-sm text-muted-500 mb-1">邮箱</label>
                <p class="text-base">
                  {{ profile.email }}
                </p>
              </div>

              <!-- Mobile -->
              <div>
                <label class="block text-sm text-muted-500 mb-1">手机号</label>
                <template v-if="isEditing">
                  <UInput
                    v-model="editForm.mobile"
                    placeholder="输入手机号"
                  />
                </template>
                <template v-else>
                  <p class="text-base">
                    {{ profile.mobile || '-' }}
                  </p>
                </template>
              </div>

              <!-- Linked Person -->
              <div>
                <label class="block text-sm text-muted-500 mb-1">关联贡献者</label>
                <p class="text-base">
                  <template v-if="profile.personName">
                    <NuxtLink
                      :to="`/dashboard/contributors?id=${profile.personId}`"
                      class="text-primary hover:underline"
                    >
                      {{ profile.personName }}
                    </NuxtLink>
                  </template>
                  <template v-else>
                    -
                  </template>
                </p>
              </div>

              <!-- Remark -->
              <div class="md:col-span-2">
                <label class="block text-sm text-muted-500 mb-1">备注</label>
                <template v-if="isEditing">
                  <UTextarea
                    v-model="editForm.remark"
                    placeholder="输入备注"
                    :rows="2"
                  />
                </template>
                <template v-else>
                  <p class="text-base">
                    {{ profile.remark || '-' }}
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
                <label class="block text-sm text-muted-500 mb-1">账户创建时间</label>
                <p class="text-base">
                  {{ formatDate(profile.createdAt) }}
                </p>
              </div>

              <div>
                <label class="block text-sm text-muted-500 mb-1">最近更新时间</label>
                <p class="text-base">
                  {{ formatDate(profile.updatedAt) }}
                </p>
              </div>

              <div>
                <label class="block text-sm text-muted-500 mb-1">最近登录时间</label>
                <p class="text-base">
                  {{ formatDate(profile.latestLoggedAt) }}
                </p>
              </div>

              <div>
                <label class="block text-sm text-muted-500 mb-1">最近登录IP</label>
                <p class="text-base">
                  {{ profile.loginIp || '-' }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <div
          v-else
          class="flex flex-col items-center justify-center py-20 text-muted-500"
        >
          <UIcon
            name="i-lucide-user-x"
            class="w-12 h-12 mb-4"
          />
          <p>无法加载用户资料</p>
        </div>
      </template>
    </UDashboardPanel>

    <!-- Password Change Modal -->
    <UModal v-model:open="showPasswordModal">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">
                修改密码
              </h3>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="showPasswordModal = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <UFormField
              label="当前密码"
              hint="如果从未设置过密码可留空"
            >
              <UInput
                v-model="passwordForm.currentPassword"
                type="password"
                placeholder="输入当前密码"
              />
            </UFormField>

            <UFormField
              label="新密码"
              required
            >
              <UInput
                v-model="passwordForm.newPassword"
                type="password"
                placeholder="输入新密码（至少6位）"
              />
            </UFormField>

            <UFormField
              label="确认新密码"
              required
            >
              <UInput
                v-model="passwordForm.confirmPassword"
                type="password"
                placeholder="再次输入新密码"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showPasswordModal = false"
              />
              <UButton
                label="确认修改"
                color="primary"
                :loading="passwordLoading"
                @click="changePassword"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
