<script setup lang="ts">
import type { FetchError } from 'ofetch'

interface ShareRecord {
  id: number
  shared_to_uid: string
  real_name: string | null
  permission: 'read' | 'write'
  is_opened: boolean
}

interface SharesResponse {
  data: ShareRecord[]
}

interface SharePostResponse {
  code: number
  message: string
  data?: {
    notifiedOnly?: boolean
  }
}

interface UserToAdd {
  uid: string
  realName: string
  deptCode?: string | null
  deptName?: string | null
}

const props = defineProps<{
  open: boolean
  docId: string
  docTitle: string
  deptCode?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const modalTitle = computed(() => props.docTitle || '未命名文档')

const loading = ref(false)

// 共享模式状态
const usersToAddUids = ref<string[]>([])
const usersToAdd = ref<UserToAdd[]>([])
const shares = ref<ShareRecord[]>([])
const isWritePermission = ref(false)
const shareMessage = ref('')

const toast = useToast()
const { userRealname, userNickname, user } = useAuth()

const currentUserName = computed(() => {
  return userRealname.value || userNickname.value || user.value || '有人'
})

const selectedPermission = computed(() => isWritePermission.value ? 'write' : 'read')
const actionButtonLabel = computed(() => props.deptCode ? '共享/提醒' : '共享')

// 批量执行共享/提醒（部门文档：同部门走提醒，非同部门走共享）
const shareOrRemind = async () => {
  if (usersToAdd.value.length === 0) return

  loading.value = true
  let shareCount = 0
  let remindCount = 0
  let failCount = 0
  const errors: string[] = []

  const promises = usersToAdd.value.map(async (targetUser) => {
    const shouldRemind = !!props.deptCode && targetUser.deptCode === props.deptCode
    const actionLabel = shouldRemind ? '提醒' : '共享'
    try {
      const response = await $fetch<SharePostResponse>(`/api/documents/${props.docId}/shares`, {
        method: 'POST',
        body: {
          sharedToUid: targetUser.uid,
          permission: shouldRemind ? 'write' : selectedPermission.value,
          ownerName: currentUserName.value,
          message: shareMessage.value.trim() || undefined
        }
      })

      if (shouldRemind || response.data?.notifiedOnly) {
        remindCount++
      } else {
        shareCount++
      }
    } catch (e: unknown) {
      console.error(`Failed to ${actionLabel} ${targetUser.uid}`, e)
      const fetchErr = e as FetchError
      errors.push(`${targetUser.realName}（${actionLabel}）: ${fetchErr.data?.message || fetchErr.message || '未知错误'}`)
      failCount++
    }
  })

  await Promise.all(promises)

  if (shareCount > 0) {
    toast.add({ title: `成功共享给 ${shareCount} 人`, color: 'success' })
  }
  if (remindCount > 0) {
    toast.add({
      title: `已提醒 ${remindCount} 位成员`,
      description: props.deptCode ? '本部门成员仅发送提醒，不新增到共享列表' : undefined,
      color: 'info'
    })
  }
  if (failCount > 0) {
    toast.add({
      title: `${failCount} 人操作失败`,
      description: errors.join(', '),
      color: 'error'
    })
  }

  if (shareCount > 0 || remindCount > 0) {
    usersToAdd.value = []
    usersToAddUids.value = []
    shareMessage.value = ''
    await fetchShares()
  }

  loading.value = false
}

// 获取已共享列表
const fetchShares = async () => {
  try {
    const res = await $fetch<SharesResponse>(`/api/documents/${props.docId}/shares`)
    shares.value = res.data || []
  } catch (error) {
    console.error('Fetch shares failed:', error)
  }
}

// 移除共享
const removeShare = async (share: ShareRecord) => {
  try {
    await $fetch(`/api/documents/${props.docId}/shares/${share.id}`, {
      method: 'DELETE'
    })
    shares.value = shares.value.filter(s => s.id !== share.id)
    toast.add({ title: '已取消共享', color: 'success' })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误'
    toast.add({ title: '操作失败', description: message, color: 'error' })
  }
}

// 监听弹窗打开
watch(isOpen, (val) => {
  if (val) {
    fetchShares()
  }
})
</script>

<template>
  <UModal v-model:open="isOpen" :ui="{ content: 'sm:max-w-2xl w-[min(96vw,56rem)] max-h-[min(82vh,40rem)] overflow-hidden' }">
    <template #content>
      <UCard class="flex flex-col min-h-0 max-h-[min(82vh,40rem)]">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-share-2" class="w-5 h-5" />
            <h3 class="text-lg font-semibold">
              {{ deptCode ? '共享/提醒' : '共享文档' }}：{{ modalTitle }}
            </h3>
          </div>
        </template>

        <div class="flex-1 min-h-0 overflow-y-auto pr-1">
          <div v-if="deptCode" class="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted">
            选择本部门人员将发送提醒消息，选择非本部门人员将为其设置读/写权限。
          </div>

          <div class="mb-4">
            <UTextarea
              v-model="shareMessage"
              placeholder="添加附言（可选）"
              :rows="2"
              autoresize
              :maxrows="4"
              class="w-full"
            />
          </div>

          <div class="space-y-4">
            <div class="flex gap-3 items-center">
              <div class="flex-1 w-full">
                <UserTreeSelector
                  v-model="usersToAddUids"
                  v-model:users="usersToAdd"
                  :exclude-uids="user ? [user] : []"
                  width-class="w-full"
                  placeholder="按部门选择员工..."
                />
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="text-sm text-muted">只读</span>
                <USwitch v-model="isWritePermission" />
                <span class="text-sm text-muted">读写</span>
              </div>
              <UButton
                :label="actionButtonLabel"
                color="primary"
                :loading="loading"
                :disabled="usersToAdd.length === 0"
                @click="shareOrRemind"
              />
            </div>

            <div>
              <h4 class="text-sm font-medium text-muted mb-3">
                已共享给
              </h4>
              <div
                v-if="shares.length === 0"
                class="text-sm h-48 overflow-y-auto text-dimmed py-4 text-center border border-dashed border-default rounded-lg"
              >
                暂无共享记录
              </div>
              <div v-else class="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                <div
                  v-for="share in shares"
                  :key="share.id"
                  class="flex justify-between items-center p-3 rounded-lg bg-elevated border border-default"
                >
                  <div class="flex items-center gap-3">
                    <UAvatar :alt="share.real_name ?? undefined" size="sm" />
                    <div>
                      <div class="text-sm font-medium">
                        {{ share.real_name || share.shared_to_uid }}
                      </div>
                      <div class="text-xs text-dimmed">
                        {{ share.permission === 'read' ? '只读' : '读写' }}
                        · {{ share.is_opened ? '已读' : '未读' }}
                      </div>
                    </div>
                  </div>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="sm"
                    @click="removeShare(share)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton label="完成" variant="soft" @click="isOpen = false" />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
