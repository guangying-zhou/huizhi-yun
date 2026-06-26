<script setup lang="ts">
const router = useRouter()
const toast = useToast()

const TEAM_TYPE: Record<string, { label: string, icon: string }> = {
  sales: { label: '销售团队', icon: 'i-lucide-trending-up' },
  business: { label: '商务团队', icon: 'i-lucide-file-text' },
  presales: { label: '售前支持', icon: 'i-lucide-presentation' }
}

const MEMBER_ROLE: Record<string, string> = {
  senior_manager: '高级经理',
  manager: '经理',
  assistant: '助理',
  member: '成员'
}

// 加载团队列表
const { data: teams, refresh } = useFetch('/api/v1/teams', {
  transform: (res: any) => res.data || []
})

// 选中的团队
const selectedTeamId = ref<number | null>(null)
const teamDetail = ref<any>(null)
async function refreshDetail() {
  if (!selectedTeamId.value) {
    teamDetail.value = null
    return
  }
  try {
    const res = await $fetch<any>(`/api/v1/teams/${selectedTeamId.value}`)
    teamDetail.value = res.data
  } catch {
    teamDetail.value = null
  }
}
watch(selectedTeamId, () => refreshDetail())

function selectTeam(id: number) {
  selectedTeamId.value = id
}

// 新建团队弹窗
const showCreateModal = ref(false)
const createLoading = ref(false)
const createForm = reactive({
  code: '',
  name: '',
  team_type: 'sales',
  parent_id: null as number | null,
  description: ''
})

const teamTypeOptions = Object.entries(TEAM_TYPE).map(([v, o]) => ({ label: o.label, value: v }))
const parentOptions = computed(() => [
  { label: '(无上级)', value: null as any },
  ...(teams.value || []).map((t: any) => ({ label: t.name, value: t.id }))
])

async function createTeam() {
  if (!createForm.name.trim() || !createForm.code.trim()) {
    toast.add({ title: '请填写团队编码和名称', color: 'error' })
    return
  }
  createLoading.value = true
  try {
    await $fetch('/api/v1/teams', { method: 'POST', body: createForm })
    toast.add({ title: '团队创建成功', color: 'success' })
    showCreateModal.value = false
    createForm.code = ''
    createForm.name = ''
    createForm.description = ''
    refresh()
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '创建失败', color: 'error' })
  } finally {
    createLoading.value = false
  }
}

// 添加成员弹窗
const showAddMemberModal = ref(false)
const addMemberLoading = ref(false)
const memberForm = reactive({
  user_id: '',
  role: 'member'
})

const roleOptions = Object.entries(MEMBER_ROLE).map(([v, l]) => ({ label: l, value: v }))

async function addMember() {
  if (!memberForm.user_id.trim()) {
    toast.add({ title: '请选择用户', color: 'error' })
    return
  }
  addMemberLoading.value = true
  try {
    await $fetch(`/api/v1/teams/${selectedTeamId.value}/members`, {
      method: 'POST',
      body: memberForm
    })
    toast.add({ title: '添加成功', color: 'success' })
    showAddMemberModal.value = false
    memberForm.user_id = ''
    memberForm.role = 'member'
    refreshDetail()
    refresh()
  } catch (err: any) {
    toast.add({ title: err?.data?.statusMessage || '添加失败', color: 'error' })
  } finally {
    addMemberLoading.value = false
  }
}

// 移除成员
async function removeMember(memberId: number) {
  if (!confirm('确定移除该成员？')) return
  try {
    await $fetch(`/api/v1/teams/${selectedTeamId.value}/members`, {
      method: 'DELETE',
      body: { member_id: memberId }
    })
    toast.add({ title: '已移除', color: 'success' })
    refreshDetail()
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

const memberColumns = [
  { accessorKey: 'user_id', header: '用户' },
  { accessorKey: 'role', header: '角色' },
  { accessorKey: 'joined_at', header: '加入时间' },
  { accessorKey: 'actions', header: '' }
]
</script>

<template>
  <UDashboardPanel id="settings-teams">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/settings')"
        />
        <h1 class="truncate text-base font-semibold">
          团队管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建团队"
          icon="i-lucide-plus"
          color="primary"
          @click="showCreateModal = true"
        />
      </Teleport>

      <div class="flex h-full">
        <!-- 左侧团队列表 -->
        <div class="w-72 border-r border-default p-3 space-y-2 overflow-y-auto">
          <div
            v-for="team in teams"
            :key="team.id"
            class="p-3 rounded-lg cursor-pointer transition-colors"
            :class="selectedTeamId === team.id ? 'bg-primary/10 border border-primary' : 'hover:bg-elevated border border-transparent'"
            @click="selectTeam(team.id)"
          >
            <div class="flex items-center gap-2">
              <UIcon :name="TEAM_TYPE[team.team_type]?.icon || 'i-lucide-users'" class="text-muted w-4 h-4" />
              <span class="font-medium text-sm">{{ team.name }}</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ TEAM_TYPE[team.team_type]?.label || team.team_type }}
              </UBadge>
              <span class="text-xs text-muted">{{ team.member_count || 0 }} 人</span>
            </div>
          </div>
          <div v-if="!teams?.length" class="text-center py-8 text-muted text-sm">
            暂无团队
          </div>
        </div>

        <!-- 右侧团队详情 -->
        <div class="flex-1 p-4 overflow-y-auto">
          <div v-if="teamDetail" class="space-y-4">
            <!-- 团队信息 -->
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold">{{ teamDetail.name }}</span>
                    <UBadge color="neutral" variant="subtle" size="xs">
                      {{ TEAM_TYPE[teamDetail.team_type]?.label }}
                    </UBadge>
                  </div>
                  <span class="text-xs text-muted font-mono">{{ teamDetail.code }}</span>
                </div>
              </template>
              <div class="grid grid-cols-2 gap-y-2 text-sm">
                <div class="flex">
                  <span class="text-muted w-20 shrink-0">负责人</span><span>{{ teamDetail.leader_user_id || '-' }}</span>
                </div>
                <div class="flex">
                  <span class="text-muted w-20 shrink-0">上级团队</span><span>{{ teamDetail.parent_name || '(无)' }}</span>
                </div>
                <div class="flex col-span-2">
                  <span class="text-muted w-20 shrink-0">描述</span><span>{{ teamDetail.description || '-' }}</span>
                </div>
              </div>
            </UCard>

            <!-- 成员列表 -->
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-sm">团队成员 ({{ teamDetail.members?.length || 0 }})</span>
                  <UButton
                    label="添加成员"
                    icon="i-lucide-user-plus"
                    size="sm"
                    variant="soft"
                    @click="showAddMemberModal = true"
                  />
                </div>
              </template>
              <UTable :data="teamDetail.members || []" :columns="memberColumns">
                <template #user_id-cell="{ row }">
                  <span class="font-medium">{{ (row.original as any).user_id }}</span>
                </template>
                <template #role-cell="{ row }">
                  <UBadge
                    :color="(row.original as any).role === 'senior_manager' || (row.original as any).role === 'manager' ? 'primary' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ MEMBER_ROLE[(row.original as any).role] || (row.original as any).role }}
                  </UBadge>
                </template>
                <template #joined_at-cell="{ row }">
                  <span class="text-xs text-muted">{{ (row.original as any).joined_at || '-' }}</span>
                </template>
                <template #actions-cell="{ row }">
                  <UButton
                    icon="i-lucide-user-minus"
                    variant="ghost"
                    color="error"
                    size="xs"
                    @click="removeMember((row.original as any).id)"
                  />
                </template>
                <template #empty>
                  <div class="text-center py-6 text-muted text-sm">
                    暂无成员
                  </div>
                </template>
              </UTable>
            </UCard>

            <!-- 子团队 -->
            <UCard v-if="teamDetail.children?.length">
              <template #header>
                <span class="font-semibold text-sm">下级团队 ({{ teamDetail.children.length }})</span>
              </template>
              <div class="space-y-2">
                <div
                  v-for="child in teamDetail.children"
                  :key="child.id"
                  class="flex items-center justify-between p-2 rounded hover:bg-elevated cursor-pointer"
                  @click="selectTeam(child.id)"
                >
                  <div>
                    <span class="text-sm font-medium">{{ child.name }}</span>
                    <span class="text-xs text-muted ml-2">{{ child.member_count }} 人</span>
                  </div>
                  <UIcon name="i-lucide-chevron-right" class="text-muted" />
                </div>
              </div>
            </UCard>
          </div>

          <div v-else class="flex flex-col items-center justify-center h-full text-muted">
            <UIcon name="i-lucide-users" class="text-4xl mb-3" />
            <p class="text-sm">
              选择左侧团队查看详情
            </p>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- 新建团队弹窗 -->
  <UModal v-model:open="showCreateModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">新建团队</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showCreateModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="团队编码" required>
            <UInput v-model="createForm.code" placeholder="如 TEAM-SALES-03" class="w-full" />
          </UFormField>
          <UFormField label="团队名称" required>
            <UInput v-model="createForm.name" placeholder="团队名称" class="w-full" />
          </UFormField>
          <UFormField label="团队类型">
            <USelect v-model="createForm.team_type" :items="teamTypeOptions" class="w-full" />
          </UFormField>
          <UFormField label="上级团队">
            <USelect v-model="createForm.parent_id" :items="parentOptions" class="w-full" />
          </UFormField>
          <UFormField label="描述">
            <UTextarea v-model="createForm.description" :rows="2" class="w-full" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showCreateModal = false"
            />
            <UButton
              label="创建"
              color="primary"
              :loading="createLoading"
              @click="createTeam"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- 添加成员弹窗 -->
  <UModal v-model:open="showAddMemberModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">添加成员</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showAddMemberModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="用户" required>
            <UserPicker v-model="memberForm.user_id" />
          </UFormField>
          <UFormField label="角色">
            <USelect v-model="memberForm.role" :items="roleOptions" class="w-full" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showAddMemberModal = false"
            />
            <UButton
              label="添加"
              color="primary"
              :loading="addMemberLoading"
              @click="addMember"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
