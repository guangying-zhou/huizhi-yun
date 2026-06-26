<script setup lang="ts">
/**
 * 员工树形下拉选择器（按部门组织）
 *
 * 用法：
 *   <UserTreeSelector v-model="uids" v-model:users="users" />
 *   <UserTreeSelector v-model="uids" selection-mode="single" />
 *
 * - v-model:               选中员工的 uid 数组（single 模式下最多 1 个）
 * - v-model:users (可选):   选中员工的完整对象数组
 * - selection-mode:        选择模式，`multiple` | `single`（默认 multiple）
 * - show-root-dept:        是否显示根部门（默认 false）
 * - hide-committees:       是否隐藏委员会节点（默认 false）
 * - exclude-uids:          需要排除的 uid 列表（如排除当前用户）
 * - scope-dept-code:       限定到某个部门子树
 *
 * 特性：
 * - 部门显示顺序与数据库 sort_order 一致；委员会统一排在部门之后
 * - 委员会支持通过 user_departments 显示成员（需 /api/directory/user-departments）
 * - 点击部门行：只展开/折叠，不选中；只有点击 checkbox 才勾选
 * - 点击员工行：切换勾选
 */
import type { TreeItem } from '@nuxt/ui'
import type { TreeItemSelectEvent } from 'reka-ui'

interface DeptLike {
  deptCode: string
  name: string
  parentId?: string | null
  orgType?: string
  children?: DeptLike[]
}

interface AccountUserLike {
  uid: string
  realName?: string | null
  deptCode?: string | null
  deptName?: string | null
  avatar?: string | null
  status?: number
}

interface UserDeptPair {
  uid: string
  deptCode: string
}

interface SelectableUser {
  uid: string
  realName: string
  deptCode?: string | null
  deptName?: string | null
  avatar?: string | null
}

interface TreeNode extends TreeItem {
  key: string
  kind: 'dept' | 'user'
  orgType?: string
  uid?: string
  deptCode?: string
  user?: SelectableUser
  children?: TreeNode[]
}

const props = withDefaults(defineProps<{
  modelValue: string[]
  users?: SelectableUser[]
  selectionMode?: 'multiple' | 'single'
  placeholder?: string
  showRootDept?: boolean
  hideCommittees?: boolean
  excludeUids?: string[]
  widthClass?: string
  disabled?: boolean
  scopeDeptCode?: string
}>(), {
  users: () => [],
  selectionMode: 'multiple',
  placeholder: '选择员工...',
  showRootDept: false,
  hideCommittees: false,
  excludeUids: () => [],
  widthClass: 'w-72',
  disabled: false,
  scopeDeptCode: ''
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
  (e: 'update:users', users: SelectableUser[]): void
}>()

interface DeptsResp {
  code: number
  data?: { tree?: DeptLike[], flat?: DeptLike[] }
}
interface UsersResp {
  code: number
  data?: { items?: AccountUserLike[] } | AccountUserLike[]
}
interface UserDeptsResp {
  code: number
  data?: UserDeptPair[]
}

interface DeptMembersResp {
  code: number
  data?: Array<{ uid: string, realName: string | null }>
}

const sharedLoading = ref(false)
const sharedLoaded = ref(false)
const sharedDepartments = ref<DeptLike[]>([])
const sharedAllUsers = ref<AccountUserLike[]>([])
const sharedUserDeptPairs = ref<UserDeptPair[]>([])
const sharedCommitteeMembers = ref<Map<string, string[]>>(new Map())
let loadPromise: Promise<void> | null = null

const loading = sharedLoading
const departments = sharedDepartments
const allUsers = sharedAllUsers
const userDeptPairs = sharedUserDeptPairs
const committeeMembers = sharedCommitteeMembers
const open = ref(false)
const keyword = ref('')

function collectCommitteeCodes(nodes: DeptLike[]): string[] {
  const out: string[] = []
  const walk = (list: DeptLike[]) => {
    for (const n of list) {
      if (n.orgType === 'committee') out.push(n.deptCode)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

async function loadCommitteeMembersFallback(committeeCodes: string[]) {
  if (committeeCodes.length === 0) return
  const map = new Map<string, string[]>()
  await Promise.all(committeeCodes.map(async (code) => {
    try {
      const res = await $fetch<DeptMembersResp>(`/api/directory/departments/${encodeURIComponent(code)}/members`)
      if (res?.code === 0 && Array.isArray(res.data)) {
        map.set(code, res.data.map(m => m.uid))
      }
    } catch (e) {
      console.warn(`[UserTreeSelector] 委员会 ${code} 成员加载失败`, e)
    }
  }))
  committeeMembers.value = map
}

async function loadData() {
  if (sharedLoaded.value) return
  if (loadPromise) {
    await loadPromise
    return
  }

  loadPromise = (async () => {
    loading.value = true
    try {
      const [deptRes, userRes, udRes] = await Promise.all([
        $fetch<DeptsResp>('/api/directory/departments'),
        $fetch<UsersResp>('/api/directory/users', { params: { pageSize: 1000 } }),
        $fetch<UserDeptsResp>('/api/directory/user-departments').catch((err) => {
          console.warn('[UserTreeSelector] /api/directory/user-departments 不可用，将回退按委员会逐个拉取', err?.message || err)
          return { code: -1 } as UserDeptsResp
        })
      ])
      if (deptRes?.code === 0 && deptRes.data?.tree) {
        departments.value = deptRes.data.tree
      }
      if (userRes?.code === 0 && userRes.data) {
        const data = userRes.data
        allUsers.value = Array.isArray(data) ? data : (data.items || [])
      }
      if (udRes?.code === 0 && Array.isArray(udRes.data) && udRes.data.length > 0) {
        userDeptPairs.value = udRes.data
      } else {
        // 回退：逐个拉取委员会成员
        const committeeCodes = collectCommitteeCodes(departments.value)
        await loadCommitteeMembersFallback(committeeCodes)
      }
      sharedLoaded.value = true
    } catch (e) {
      console.error('[UserTreeSelector] 加载失败', e)
    } finally {
      loading.value = false
      loadPromise = null
    }
  })()

  await loadPromise
}

onMounted(loadData)

// ---------- 构建用户映射 ----------
const availableUserMap = computed<Map<string, SelectableUser>>(() => {
  const excluded = new Set(props.excludeUids)
  const m = new Map<string, SelectableUser>()
  for (const u of allUsers.value) {
    if (excluded.has(u.uid)) continue
    if (u.status !== undefined && u.status === 0) continue
    m.set(u.uid, {
      uid: u.uid,
      realName: u.realName || u.uid,
      deptCode: u.deptCode || null,
      deptName: u.deptName || null,
      avatar: u.avatar || null
    })
  }
  return m
})

const deptParentMap = computed<Map<string, string | null>>(() => {
  const map = new Map<string, string | null>()
  const walk = (nodes: DeptLike[]) => {
    for (const node of nodes) {
      map.set(node.deptCode, node.parentId || null)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(departments.value)
  return map
})

// 按 deptCode 分组用户：
// - 若有 user_departments 数据（推荐），直接使用
// - 否则回退：主部门来源于 /api/directory/users，委员会来源于部门成员接口
const usersByDept = computed<Map<string, SelectableUser[]>>(() => {
  const m = new Map<string, SelectableUser[]>()
  const push = (deptCode: string, user: SelectableUser) => {
    if (!m.has(deptCode)) m.set(deptCode, [])
    const list = m.get(deptCode)!
    if (!list.find(u => u.uid === user.uid)) list.push(user)
  }

  if (userDeptPairs.value.length > 0) {
    for (const pair of userDeptPairs.value) {
      const user = availableUserMap.value.get(pair.uid)
      if (user) push(pair.deptCode, user)
    }
  } else {
    // 1) 主部门（来自 users 列表）
    for (const user of availableUserMap.value.values()) {
      if (user.deptCode) push(user.deptCode, user)
    }
    // 2) 委员会成员（通过 dept-members 回退拉取）
    for (const [committeeCode, uids] of committeeMembers.value) {
      for (const uid of uids) {
        const user = availableUserMap.value.get(uid)
        if (user) push(committeeCode, user)
      }
    }
  }

  for (const [k, list] of m) {
    list.sort((a, b) => a.realName.localeCompare(b.realName, 'zh-CN'))
    m.set(k, list)
  }
  return m
})

// ---------- 构建树 ----------
function orderDepts(nodes: DeptLike[]): DeptLike[] {
  // 保留 API 顺序（来自 sort_order），委员会统一移到后面
  const regular: DeptLike[] = []
  const committees: DeptLike[] = []
  for (const n of nodes) {
    if (props.hideCommittees && n.orgType === 'committee') continue
    if (n.orgType === 'committee') committees.push(n)
    else regular.push(n)
  }
  return [...regular, ...committees]
}

const expandedDeptCodes = computed<Set<string>>(() => {
  const selectedUids = new Set(props.modelValue || [])
  const deptCodes = new Set<string>()

  if (userDeptPairs.value.length > 0) {
    for (const pair of userDeptPairs.value) {
      if (selectedUids.has(pair.uid)) deptCodes.add(pair.deptCode)
    }
  } else {
    for (const uid of selectedUids) {
      const deptCode = availableUserMap.value.get(uid)?.deptCode
      if (deptCode) deptCodes.add(deptCode)
    }
  }

  const expanded = new Set<string>()
  for (const deptCode of deptCodes) {
    let current: string | null | undefined = deptCode
    while (current) {
      expanded.add(current)
      current = deptParentMap.value.get(current)
    }
  }
  return expanded
})

function buildTree(nodes: DeptLike[], depth = 0): TreeNode[] {
  const out: TreeNode[] = []
  for (const dept of orderDepts(nodes)) {
    const childDepts = buildTree(dept.children || [], depth + 1)
    const deptUsers = usersByDept.value.get(dept.deptCode) || []
    const userNodes: TreeNode[] = deptUsers.map(u => ({
      key: `user:${dept.deptCode}:${u.uid}`,
      kind: 'user',
      uid: u.uid,
      label: u.realName,
      user: u
    }))

    const children = [...childDepts, ...userNodes]
    out.push({
      key: `dept:${dept.deptCode}`,
      kind: 'dept',
      orgType: dept.orgType,
      deptCode: dept.deptCode,
      label: dept.name,
      defaultExpanded: depth < 1 || expandedDeptCodes.value.has(dept.deptCode),
      children: children.length > 0 ? children : undefined
    })
  }
  return out
}

const fullTree = computed<TreeNode[]>(() => buildTree(departments.value))

function findSubtree(nodes: TreeNode[], deptCode: string): TreeNode | null {
  for (const n of nodes) {
    if (n.kind === 'dept' && n.deptCode === deptCode) return n
    if (n.children) {
      const found = findSubtree(n.children as TreeNode[], deptCode)
      if (found) return found
    }
  }
  return null
}

const scopedTree = computed<TreeNode[]>(() => {
  if (props.scopeDeptCode) {
    const sub = findSubtree(fullTree.value, props.scopeDeptCode)
    return sub ? [sub] : []
  }
  return fullTree.value
})

const visibleTree = computed<TreeNode[]>(() => {
  if (props.showRootDept) return scopedTree.value
  if (scopedTree.value.length === 1 && scopedTree.value[0]!.children) {
    return scopedTree.value[0]!.children as TreeNode[]
  }
  return scopedTree.value
})

// ---------- 搜索过滤 ----------
function filterTree(nodes: TreeNode[], kw: string): TreeNode[] {
  if (!kw) return nodes
  const lower = kw.toLowerCase()
  const out: TreeNode[] = []
  for (const node of nodes) {
    const selfMatch
      = (typeof node.label === 'string' && node.label.toLowerCase().includes(lower))
        || (node.kind === 'user' && node.uid?.toLowerCase().includes(lower))
    const kids = node.children ? filterTree(node.children as TreeNode[], kw) : undefined
    if (selfMatch || (kids && kids.length > 0)) {
      out.push({
        ...node,
        defaultExpanded: true,
        children: kids && kids.length > 0 ? kids : node.children
      })
    }
  }
  return out
}

const displayTree = computed<TreeNode[]>(
  () => filterTree(visibleTree.value, keyword.value.trim())
)

// ---------- 选中状态 ----------
const nodesByUid = computed(() => {
  const map = new Map<string, TreeNode[]>()
  function walk(list: TreeNode[]) {
    for (const n of list) {
      if (n.kind === 'user' && n.uid) {
        if (!map.has(n.uid)) map.set(n.uid, [])
        map.get(n.uid)!.push(n)
      }
      if (n.children) walk(n.children as TreeNode[])
    }
  }
  walk(fullTree.value)
  return map
})

const treeSelection = ref<TreeNode[]>([])
let lastEmittedSignature = ''

interface NodeMeta {
  uids: string[]
  selected: boolean
  indeterminate: boolean
}

function uidsSignature(uids: Iterable<string>) {
  return [...new Set(uids)].sort().join(',')
}

function emitByUids(uids: string[]) {
  const uniqueUids = props.selectionMode === 'single'
    ? [...new Set(uids)].slice(-1)
    : [...new Set(uids)]
  const picked: SelectableUser[] = []
  for (const uid of uniqueUids) {
    const u = availableUserMap.value.get(uid)
    if (u) picked.push(u)
  }

  lastEmittedSignature = uidsSignature(uniqueUids)
  rebuildFromUids(uniqueUids)
  emit('update:modelValue', uniqueUids)
  emit('update:users', picked)
}

function rebuildFromUids(uids: string[]) {
  const selected: TreeNode[] = []
  const seen = new Set<string>()
  for (const uid of uids) {
    const nodes = nodesByUid.value.get(uid) || []
    for (const n of nodes) {
      if (!seen.has(n.key)) {
        seen.add(n.key)
        selected.push(n)
      }
    }
  }
  treeSelection.value = selected
}

// 仅当"外部"修改了 modelValue（非本组件刚 emit 的）时同步回 treeSelection
watch(() => props.modelValue, (uids) => {
  const sig = uidsSignature(uids || [])
  if (sig === lastEmittedSignature) return
  lastEmittedSignature = sig
  rebuildFromUids(uids || [])
}, { immediate: true, deep: true })

// 树节点数据加载完成后（nodesByUid 改变），根据当前 modelValue 补齐选中态
watch(nodesByUid, () => {
  rebuildFromUids(props.modelValue || [])
})

const nodeMetaMap = computed<Map<string, NodeMeta>>(() => {
  const selectedUidSet = new Set(props.modelValue || [])
  const meta = new Map<string, NodeMeta>()

  const walk = (node: TreeNode): Set<string> => {
    if (node.kind === 'user' && node.uid) {
      meta.set(node.key, {
        uids: [node.uid],
        selected: selectedUidSet.has(node.uid),
        indeterminate: false
      })
      return new Set([node.uid])
    }

    const uidSet = new Set<string>()
    for (const child of (node.children || []) as TreeNode[]) {
      const childUids = walk(child)
      for (const uid of childUids) uidSet.add(uid)
    }

    let selectedCount = 0
    for (const uid of uidSet) {
      if (selectedUidSet.has(uid)) selectedCount++
    }

    const total = uidSet.size
    meta.set(node.key, {
      uids: [...uidSet],
      selected: total > 0 && selectedCount === total,
      indeterminate: selectedCount > 0 && selectedCount < total
    })
    return uidSet
  }

  for (const root of fullTree.value) walk(root)
  return meta
})

function getNodeMeta(node: TreeNode): NodeMeta {
  return nodeMetaMap.value.get(node.key) || {
    uids: [],
    selected: false,
    indeterminate: false
  }
}

function checkboxModelValue(node: TreeNode) {
  const meta = getNodeMeta(node)
  return meta.indeterminate ? 'indeterminate' : meta.selected
}

function onCheckboxClick(node: TreeNode) {
  const meta = getNodeMeta(node)
  if (meta.uids.length === 0) return

  if (props.selectionMode === 'single') {
    if (node.kind !== 'user' || !node.uid) return
    emitByUids(meta.selected ? [] : [node.uid])
    if (!meta.selected) open.value = false
    return
  }

  const next = new Set(props.modelValue || [])
  if (meta.selected) {
    for (const uid of meta.uids) next.delete(uid)
  } else {
    for (const uid of meta.uids) next.add(uid)
  }
  emitByUids([...next])
}

function handleTreeChange(items: unknown) {
  const arr = Array.isArray(items)
    ? (items as TreeNode[])
    : (items ? [items as TreeNode] : [])

  const uidSet = new Set<string>()
  for (const item of arr) {
    if (item?.kind === 'user' && item.uid) uidSet.add(item.uid)
  }
  emitByUids(Array.from(uidSet))
  if (props.selectionMode === 'single' && uidSet.size > 0) {
    open.value = false
  }
}

function onSelect(e: TreeItemSelectEvent<TreeItem>) {
  const node = e.detail.value as TreeNode | undefined
  // 部门节点：点击"行本身/展开图标"时只展开/折叠，不选中；
  // checkbox 点击由 onCheckboxClick 接管，因此这里仅拦截非 checkbox 点击。
  const origType = e.detail.originalEvent?.type
  const target = e.detail.originalEvent?.target as HTMLElement | null
  const fromCheckbox = !!target?.closest('[data-tree-checkbox="true"], [role="checkbox"], input[type="checkbox"]')
  if (node?.kind === 'dept' && origType === 'click' && !fromCheckbox) {
    e.preventDefault()
  }
}

function clearAll() {
  emitByUids([])
}

function removeOne(uid: string) {
  emitByUids((props.modelValue || []).filter(x => x !== uid))
}

const summary = computed(() => {
  const users = selectedUserObjects.value
  if (users.length === 0) return props.placeholder

  const names = users.map(u => u.realName || u.uid)
  if (props.selectionMode === 'single') return names[0] || props.placeholder
  if (names.length <= 3) return names.join('、')
  return `已选${names.slice(0, 2).join('、')}等${names.length}人`
})

const selectedUserObjects = computed<SelectableUser[]>(() => {
  const uids = props.modelValue || []
  if (uids.length === 0) return []
  const fromProps = new Map(props.users.map(u => [u.uid, u]))
  return uids.map(uid => fromProps.get(uid) || availableUserMap.value.get(uid) || {
    uid,
    realName: uid,
    deptCode: null,
    deptName: null,
    avatar: null
  })
})

function confirmSelection() {
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open" :disabled="disabled" :ui="{ content: 'p-0' }">
    <UButton
      color="neutral"
      variant="outline"
      :disabled="disabled"
      :class="widthClass"
      class="justify-between font-normal"
      trailing-icon="i-lucide-chevron-down"
    >
      <span class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-users" class="w-4 h-4 text-dimmed shrink-0" />
        <span class="truncate" :class="modelValue.length === 0 ? 'text-dimmed' : ''">
          {{ summary }}
        </span>
      </span>
    </UButton>

    <template #content>
      <div class="w-[22rem] max-w-[calc(100vw-2rem)] flex flex-col">
        <div class="p-2 border-b border-default flex items-center gap-2">
          <UInput
            v-model="keyword"
            icon="i-lucide-search"
            placeholder="搜索员工或部门"
            size="sm"
            :ui="{ base: 'w-full' }"
            class="flex-1"
          />
        </div>

        <div
          v-if="props.selectionMode === 'multiple' && selectedUserObjects.length > 0"
          class="px-2 pt-2 pb-1 border-b border-default"
        >
          <div class="flex flex-wrap gap-1 items-center max-h-20 overflow-y-auto">
            <UBadge
              v-for="u in selectedUserObjects"
              :key="u.uid"
              color="primary"
              variant="soft"
              size="sm"
              class="gap-1 pr-1"
            >
              <span class="truncate max-w-[8rem]">{{ u.realName }}</span>
              <button
                type="button"
                class="ml-0.5 hover:text-primary rounded-sm"
                aria-label="移除"
                @click.stop="removeOne(u.uid)"
              >
                <UIcon name="i-lucide-x" class="w-3 h-3" />
              </button>
            </UBadge>
          </div>
          <div class="mt-2 flex justify-end gap-2">
            <UButton
              label="清空已选"
              leading-icon="i-lucide-eraser"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="clearAll"
            />
            <UButton
              label="确定"
              color="primary"
              variant="soft"
              size="xs"
              @click="confirmSelection"
            />
          </div>
        </div>

        <div class="max-h-80 overflow-y-auto p-1">
          <div v-if="loading" class="text-center py-6 text-sm text-dimmed">
            加载中...
          </div>
          <div v-else-if="displayTree.length === 0" class="text-center py-6 text-sm text-dimmed">
            {{ keyword ? '无匹配结果' : '暂无数据' }}
          </div>
          <UTree
            v-else
            :model-value="treeSelection as unknown as TreeItem[]"
            :items="displayTree as unknown as TreeItem[]"
            :get-key="(item: TreeItem) => (item as TreeNode).key"
            :as="{ link: 'div' }"
            :multiple="props.selectionMode === 'multiple'"
            propagate-select
            bubble-select
            size="sm"
            @update:model-value="handleTreeChange"
            @select="onSelect"
          >
            <template #item-leading="{ item }">
              <div class="flex items-center gap-1.5" @click.stop>
                <div
                  data-tree-checkbox="true"
                  class="shrink-0"
                  @click.stop.prevent="onCheckboxClick(item as TreeNode)"
                >
                  <UCheckbox
                    :model-value="checkboxModelValue(item as TreeNode)"
                    tabindex="-1"
                    class="pointer-events-none"
                  />
                </div>
                <UIcon
                  v-if="(item as TreeNode).kind === 'dept' && (item as TreeNode).orgType === 'committee'"
                  name="i-lucide-users"
                  class="w-4 h-4 text-info shrink-0"
                />
                <UIcon
                  v-else-if="(item as TreeNode).kind === 'dept'"
                  name="i-lucide-building-2"
                  class="w-4 h-4 text-warning shrink-0"
                />
                <UAvatar
                  v-else-if="(item as TreeNode).user?.avatar"
                  :src="(item as TreeNode).user?.avatar || undefined"
                  :alt="(item as TreeNode).label as string"
                  size="2xs"
                />
                <UAvatar
                  v-else
                  :alt="(item as TreeNode).label as string"
                  icon="i-lucide-user"
                  size="2xs"
                />
              </div>
            </template>
            <template #item-label="{ item }">
              <span class="text-sm truncate">{{ (item as TreeNode).label }}</span>
            </template>
          </UTree>
        </div>
      </div>
    </template>
  </UPopover>
</template>
