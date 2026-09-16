<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('个人资料')

const { user: authUser, userEmail, userRealname, userDepartment, userDeptCode } = useAuth()
const toast = useToast()
const avatarInput = ref<HTMLInputElement | null>(null)
const selectedAvatarFile = ref<File | null>(null)
const avatarPreviewUrl = ref<string | null>(null)
const avatarUploading = ref(false)
const passwordSaving = ref(false)
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

interface ApiResponse<T> {
  code: number
  data: T
}

interface CurrentDirectoryProfile {
  uid: string
  username: string | null
  displayName: string
  realName: string
  email: string
  avatar: string | null
  deptCode: string | null
  deptName: string | null
}

interface PasswordCapability {
  available: boolean
  provider: string
  reason: string | null
}

interface DirectoryOperation {
  operationId: string
  status: string
}

const { data: currentDirectoryData } = await useFetch<ApiResponse<CurrentDirectoryProfile>>(
  '/api/directory/me',
  {
    default: () => ({
      code: 0,
      data: {
        uid: '',
        username: null,
        displayName: '',
        realName: '',
        email: '',
        avatar: null,
        deptCode: null,
        deptName: null
      }
    })
  }
)
const currentDirectoryProfile = computed(() => currentDirectoryData.value?.data)
const profileUsername = computed(() => {
  return currentDirectoryProfile.value?.username
    || currentDirectoryProfile.value?.uid
    || authUser.value
    || ''
})
const profileRealName = computed(() => {
  return currentDirectoryProfile.value?.realName
    || currentDirectoryProfile.value?.displayName
    || userRealname.value
    || ''
})
const profileEmail = computed(() => currentDirectoryProfile.value?.email || userEmail.value || '')
const profileDepartment = computed(() => currentDirectoryProfile.value?.deptName || userDepartment.value || '')
const profileDeptCode = computed(() => currentDirectoryProfile.value?.deptCode || userDeptCode.value || '')
const profileAvatarSrc = computed(() => {
  return avatarPreviewUrl.value || resolveAvatarSrc(currentDirectoryProfile.value?.avatar) || undefined
})
const profileAvatarText = computed(() => {
  const name = profileRealName.value || profileUsername.value
  return name ? name.charAt(0).toUpperCase() : '?'
})

function clearAvatarPreview() {
  if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value)
  avatarPreviewUrl.value = null
}

function clearAvatarSelection() {
  clearAvatarPreview()
  selectedAvatarFile.value = null
  if (avatarInput.value) avatarInput.value.value = ''
}

function openAvatarPicker() {
  avatarInput.value?.click()
}

function selectAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    toast.add({ title: '不支持此图片格式', description: '请选择 PNG、JPEG 或 WebP 图片。', color: 'warning' })
    return
  }
  if (file.size > 3 * 1024 * 1024) {
    toast.add({ title: '图片过大', description: '头像文件不能超过 3MB。', color: 'warning' })
    return
  }

  clearAvatarPreview()
  selectedAvatarFile.value = file
  avatarPreviewUrl.value = URL.createObjectURL(file)
}

async function uploadAvatar() {
  const file = selectedAvatarFile.value
  if (!file) return

  avatarUploading.value = true
  try {
    const formData = new FormData()
    formData.append('avatar', file, file.name)
    const response = await $fetch<ApiResponse<{ avatar: string }>>(
      '/api/v1/console/directory/me/avatar',
      {
        method: 'PUT',
        body: formData,
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      }
    )
    if (currentDirectoryData.value?.data) {
      currentDirectoryData.value.data.avatar = response.data.avatar
    }
    clearAvatarSelection()
    if (import.meta.client) {
      window.dispatchEvent(new CustomEvent('hzy:directory-profile-updated', {
        detail: { avatar: response.data.avatar }
      }))
    }
    toast.add({
      title: '头像已更新',
      description: '新头像已保存，并会用于汇智云各应用。',
      color: 'success'
    })
  } catch (error: unknown) {
    const candidate = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '头像上传失败',
      description: candidate.data?.message || candidate.message || '请稍后重试。',
      color: 'error'
    })
  } finally {
    avatarUploading.value = false
  }
}

onBeforeUnmount(clearAvatarPreview)

const { data: passwordCapabilityData } = await useFetch<ApiResponse<PasswordCapability>>(
  '/api/v1/console/directory/me/password-capability',
  {
    default: () => ({ code: 0, data: { available: false, provider: 'ldap', reason: null } })
  }
)
const passwordCapability = computed(() => passwordCapabilityData.value?.data)

async function waitForPasswordOperation(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await $fetch<ApiResponse<DirectoryOperation>>(
      `/api/v1/console/directory/operations/${encodeURIComponent(operationId)}`
    )
    if (response.data.status === 'succeeded') return 'succeeded'
    if (['dead_letter', 'failed'].includes(response.data.status)) return 'failed'
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return 'pending'
}

async function changePassword() {
  if (!passwordForm.currentPassword) {
    toast.add({ title: '请输入当前密码', color: 'warning' })
    return
  }
  if (passwordForm.newPassword.length < 10) {
    toast.add({ title: '新密码至少需要 10 个字符', color: 'warning' })
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    toast.add({ title: '两次输入的新密码不一致', color: 'warning' })
    return
  }
  passwordSaving.value = true
  try {
    const response = await $fetch<ApiResponse<DirectoryOperation>>('/api/v1/console/directory/me/password', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      }
    })
    const status = await waitForPasswordOperation(response.data.operationId)
    if (status === 'failed') throw new Error('LDAP 拒绝了密码修改，请确认当前密码和密码策略')
    passwordForm.currentPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    toast.add({
      title: status === 'succeeded' ? '密码已修改' : '密码修改任务已提交',
      description: status === 'pending' ? 'Directory Connector 将继续在后台执行。' : '下次登录请使用新密码。',
      color: status === 'succeeded' ? 'success' : 'info'
    })
  } catch (error: unknown) {
    const candidate = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '密码修改失败',
      description: candidate.data?.message || candidate.message || '未知错误',
      color: 'error'
    })
  } finally {
    passwordSaving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="workspace-profile" :ui="dashboardPanelUi">
    <template #body>
      <div class="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <section class="border-b border-default pb-4">
          <p class="text-sm text-muted">
            工作台
          </p>
          <h2 class="mt-1 text-2xl font-semibold text-highlighted">
            个人资料
          </h2>
        </section>

        <UCard>
          <template #header>
            <span class="font-semibold">个人信息</span>
          </template>

          <div class="mb-5 flex flex-col gap-4 border-b border-default pb-5 sm:flex-row sm:items-center">
            <UAvatar
              :src="profileAvatarSrc"
              :text="profileAvatarText"
              :alt="profileRealName || profileUsername || '用户头像'"
              size="3xl"
              class="shrink-0"
            />
            <div class="min-w-0 flex-1">
              <p class="font-medium text-highlighted">
                个人头像
              </p>
              <p class="mt-1 text-sm text-muted">
                支持 PNG、JPEG 或 WebP，文件不超过 3MB。
              </p>
              <p v-if="selectedAvatarFile" class="mt-2 truncate text-sm text-toned">
                待上传：{{ selectedAvatarFile.name }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2 sm:justify-end">
              <input
                ref="avatarInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="hidden"
                @change="selectAvatar"
              >
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-image-up"
                :disabled="avatarUploading"
                @click="openAvatarPicker"
              >
                {{ currentDirectoryProfile?.avatar ? '替换头像' : '选择头像' }}
              </UButton>
              <UButton
                v-if="selectedAvatarFile"
                icon="i-lucide-upload"
                :loading="avatarUploading"
                @click="uploadAvatar"
              >
                上传头像
              </UButton>
              <UButton
                v-if="selectedAvatarFile"
                color="neutral"
                variant="ghost"
                :disabled="avatarUploading"
                @click="clearAvatarSelection"
              >
                取消
              </UButton>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="text-sm font-medium text-muted">用户名</label>
              <p class="mt-1">
                {{ profileUsername || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">真实姓名</label>
              <p class="mt-1">
                {{ profileRealName || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">邮箱</label>
              <p class="mt-1">
                {{ profileEmail || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">部门</label>
              <p class="mt-1">
                {{ profileDepartment || '-' }}
              </p>
            </div>
            <div>
              <label class="text-sm font-medium text-muted">部门编码</label>
              <p class="mt-1">
                {{ profileDeptCode || '-' }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div>
              <span class="font-semibold">登录密码</span>
              <p class="mt-1 text-sm text-muted">
                修改企业 LDAP 密码；成功后 OIDC 登录将使用新密码。
              </p>
            </div>
          </template>

          <UAlert
            v-if="!passwordCapability?.available"
            color="neutral"
            variant="soft"
            icon="i-lucide-info"
            title="当前账号暂不支持在线修改密码"
            :description="passwordCapability?.reason || '未检测到可用的 LDAP Connector。'"
          />

          <div v-else class="grid gap-4 sm:grid-cols-2">
            <UFormField label="当前密码" required class="sm:col-span-2">
              <UInput
                v-model="passwordForm.currentPassword"
                type="password"
                autocomplete="current-password"
                class="w-full"
              />
            </UFormField>
            <UFormField label="新密码" required>
              <UInput
                v-model="passwordForm.newPassword"
                type="password"
                autocomplete="new-password"
                class="w-full"
                placeholder="至少 10 个字符"
              />
            </UFormField>
            <UFormField label="确认新密码" required>
              <UInput
                v-model="passwordForm.confirmPassword"
                type="password"
                autocomplete="new-password"
                class="w-full"
              />
            </UFormField>
          </div>

          <template v-if="passwordCapability?.available" #footer>
            <div class="flex justify-end">
              <UButton
                icon="i-lucide-key-round"
                :loading="passwordSaving"
                @click="changePassword"
              >
                修改密码
              </UButton>
            </div>
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
