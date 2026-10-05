<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- 画布 + 配置面板 -->
    <div class="flex flex-1 min-h-0">
      <!-- VueFlow 画布 -->
      <div class="relative flex-1 min-w-0 bg-[#f8fafc] dark:bg-gray-950">
        <ClientOnly>
          <VueFlow
            :key="vueFlowKey"
            :nodes="flowNodes"
            :edges="flowEdges"
            :node-types="nodeTypes"
            :nodes-draggable="false"
            :nodes-connectable="false"
            :zoom-on-scroll="true"
            fit-view-on-init
            class="absolute inset-0"
            @node-click="onNodeClick"
            @pane-click="selectedIndex = null"
          >
            <Background :gap="20" :size="1.5" pattern-color="#cbd5e1" />
            <Controls position="top-left" />
          </VueFlow>
          <template #fallback>
            <div class="absolute inset-0 flex items-center justify-center text-dimmed">
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin" />
            </div>
          </template>
        </ClientOnly>

        <!-- 添加步骤按钮 -->
        <div class="absolute bottom-4 left-0 right-0 flex justify-center z-10 pointer-events-none">
          <UButton
            icon="i-lucide-plus-circle"
            variant="soft"
            color="primary"
            size="sm"
            class="pointer-events-auto shadow-sm"
            :disabled="nodes.length >= 10"
            @click="addNode"
          >
            {{ nodes.length >= 10 ? '已达上限（10步）' : '添加审批节点' }}
          </UButton>
        </div>
      </div>

      <!-- 节点配置面板 -->
      <div class="w-80 shrink-0 border-l flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
        <!-- 空状态 -->
        <div
          v-if="selectedIndex === null"
          class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <UIcon name="i-lucide-mouse-pointer-click" class="w-12 h-12 text-dimmed" />
          <div>
            <p class="text-sm font-medium text-muted">
              点击节点配置审批步骤
            </p>
            <p class="mt-1 text-xs text-dimmed">
              选中步骤后可在此编辑配置
            </p>
          </div>
          <div class="mt-2 text-xs text-dimmed bg-elevated rounded-lg p-3 space-y-1 w-full text-left">
            <p><UIcon name="i-lucide-info" class="inline w-3 h-3 mr-1" /><strong>审批</strong>：部门负责人/分管领导/上级领导</p>
            <p><UIcon name="i-lucide-info" class="inline w-3 h-3 mr-1" /><strong>会签</strong>：选择委员会 + 审批模式</p>
            <p><UIcon name="i-lucide-info" class="inline w-3 h-3 mr-1" />发起人与审批人相同时自动通过</p>
          </div>
        </div>

        <!-- 节点配置 -->
        <div v-else-if="currentNode" class="flex-1 overflow-y-auto p-4 space-y-3">
          <div class="flex items-center gap-2 pb-2 border-b">
            <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold">
              {{ selectedIndex + 1 }}
            </span>
            <h3 class="font-semibold text-default">
              节点 {{ selectedIndex + 1 }} 配置
            </h3>
          </div>

          <UFormField label="节点名称" required>
            <UInput v-model="currentNode.name" placeholder="如：部门经理审批" />
          </UFormField>

          <UFormField label="节点类型" required>
            <USelectMenu
              v-model="currentNode.type"
              :items="NODE_TYPE_OPTIONS"
              value-key="value"
              @update:model-value="onNodeTypeChange"
            />
          </UFormField>

          <!-- 审批节点：选择审批人 -->
          <template v-if="currentNode.type === 'approve'">
            <UFormField label="审批人" required>
              <USelectMenu
                v-model="approveAssigneeType"
                :items="APPROVE_ASSIGNEE_OPTIONS"
                value-key="value"
              />
            </UFormField>
          </template>

          <!-- 会签节点：选择委员会 + 审批模式 -->
          <template v-if="currentNode.type === 'countersign'">
            <UFormField label="委员会" required>
              <USelectMenu
                v-model="countersignCommittee"
                :items="committeeOptions"
                value-key="value"
                placeholder="选择委员会"
                :loading="loadingCommittees"
              />
            </UFormField>

            <UFormField label="审批模式" required>
              <USelectMenu
                v-model="currentNode.approve_mode"
                :items="COUNTERSIGN_MODE_OPTIONS"
                value-key="value"
              />
            </UFormField>

            <UFormField
              v-if="currentNode.approve_mode === 'review'"
              label="最少通过人数"
              required
            >
              <UInput
                :model-value="currentNode.min_pass_count ?? 2"
                type="number"
                :min="1"
                placeholder="2"
                @update:model-value="currentNode.min_pass_count = Number($event) || 2"
              />
            </UFormField>
          </template>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-1 pt-1">
            <UButton
              v-if="selectedIndex > 0"
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-left"
              @click="moveNode(-1)"
            >
              前移
            </UButton>
            <UButton
              v-if="selectedIndex < nodes.length - 1"
              size="xs"
              variant="ghost"
              icon="i-lucide-chevron-right"
              trailing
              @click="moveNode(1)"
            >
              后移
            </UButton>
            <div class="flex-1" />
            <UButton
              size="xs"
              color="error"
              variant="soft"
              icon="i-lucide-trash-2"
              @click="removeNode"
            >
              删除
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { VueFlow, MarkerType } from '@vue-flow/core'
import type { Node as VFNode, Edge as VFEdge, NodeTypesObject } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import ApprovalNode from './ApprovalNode.vue'
import StartEndNode from './StartEndNode.vue'

// ---------- 类型 ----------

interface AssigneeDef {
  type: string
  uid?: string
  code?: string
  scope?: string
  dept_code?: string
  field_key?: string
}

interface FlowNodeDef {
  name: string
  type: string
  approve_mode?: string
  min_pass_count?: number
  assignees: AssigneeDef[]
  skip_when?: Record<string, unknown>
  timeout_hours?: number
  auto_action?: string
}

// ---------- Props & Emits ----------

const props = defineProps<{
  modelValue: FlowNodeDef[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: FlowNodeDef[]): void
}>()

// ---------- 常量 ----------

const NODE_TYPE_OPTIONS = [
  { label: '审批', value: 'approve' },
  { label: '会签', value: 'countersign' }
]

// 审批节点的审批人选项
const APPROVE_ASSIGNEE_OPTIONS = [
  { label: '部门负责人', value: 'dept_manager' },
  { label: '分管领导', value: 'dept_leader' },
  { label: '上级领导', value: 'initiator_leader' },
  { label: '创建者（发起人）', value: 'initiator' }
]

// 会签节点的审批模式
const COUNTERSIGN_MODE_OPTIONS = [
  { label: '全签（必须全部通过）', value: 'all' },
  { label: '多数签（超过2/3通过）', value: 'majority' },
  { label: '过半签（超过半数通过）', value: 'half' },
  { label: '或签（任一通过即可）', value: 'any' }
]

const DEFAULT_NAMES = ['部门负责人审批', '分管领导审批', '上级领导审批']

// ---------- 节点类型 ----------

const nodeTypes: NodeTypesObject = {
  approvalStep: markRaw(ApprovalNode) as Component,
  startEnd: markRaw(StartEndNode) as Component
}

// ---------- 委员会列表 ----------

const committeeOptions = ref<{ label: string, value: string }[]>([])
const loadingCommittees = ref(false)

async function loadCommittees() {
  if (committeeOptions.value.length > 0) return
  loadingCommittees.value = true
  try {
    interface DeptFlat { deptCode: string, name: string, orgType?: string }
    const res = await $fetch<{ code: number, data: { flat: DeptFlat[], tree: DeptFlat[] } }>('/api/account/departments')
    const flat = res.data?.flat || []
    committeeOptions.value = flat
      .filter(d => d.orgType === 'committee')
      .map(d => ({
        label: d.name,
        value: d.deptCode
      }))
  } catch {
    committeeOptions.value = []
  } finally {
    loadingCommittees.value = false
  }
}

onMounted(() => {
  loadCommittees()
})

// ---------- 内部状态 ----------

const nodes = ref<FlowNodeDef[]>([])
const selectedIndex = ref<number | null>(null)
const vueFlowKey = ref(0)

// 同步 props → 内部
watch(() => props.modelValue, (val) => {
  nodes.value = JSON.parse(JSON.stringify(val || []))
  vueFlowKey.value++
}, { immediate: true, deep: false })

// 同步 内部 → emit
function emitUpdate() {
  const cleaned = nodes.value.map((n) => {
    const node: FlowNodeDef = {
      name: n.name,
      type: n.type,
      assignees: n.assignees.map((a) => {
        const c: AssigneeDef = { type: a.type }
        if (a.uid) c.uid = a.uid
        if (a.code) c.code = a.code
        if (a.scope) c.scope = a.scope
        if (a.dept_code) c.dept_code = a.dept_code
        if (a.field_key) c.field_key = a.field_key
        return c
      })
    }
    if (n.approve_mode) node.approve_mode = n.approve_mode
    if (n.min_pass_count && n.min_pass_count > 0) node.min_pass_count = n.min_pass_count
    if (n.skip_when && Object.keys(n.skip_when).length > 0) node.skip_when = n.skip_when
    if (n.timeout_hours) node.timeout_hours = n.timeout_hours
    if (n.auto_action) node.auto_action = n.auto_action
    return node
  })
  emit('update:modelValue', cleaned)
}

// 当前选中节点
const currentNode = computed(() => {
  if (selectedIndex.value === null) return null
  return nodes.value[selectedIndex.value] ?? null
})

// ---------- 审批节点：审批人类型 computed ----------

const approveAssigneeType = computed({
  get() {
    if (!currentNode.value || currentNode.value.type !== 'approve') return undefined
    const a = currentNode.value.assignees[0]
    return a?.type
  },
  set(val: string | undefined) {
    if (!currentNode.value || !val) return
    const nameMap: Record<string, string> = {
      dept_manager: '部门负责人审批',
      dept_leader: '分管领导审批',
      initiator_leader: '上级领导审批',
      initiator: '创建者自审批'
    }
    // 发起人自审批不需要部门 scope
    currentNode.value.assignees = val === 'initiator'
      ? [{ type: val }]
      : [{ type: val, scope: 'initiator_dept' }]
    // 自动更新节点名称（如果用户没有自定义）
    const defaultNames = Object.values(nameMap)
    if (!currentNode.value.name || defaultNames.includes(currentNode.value.name)) {
      currentNode.value.name = nameMap[val] || currentNode.value.name
    }
  }
})

// ---------- 会签节点：委员会选择 computed ----------

const countersignCommittee = computed({
  get() {
    if (!currentNode.value || currentNode.value.type !== 'countersign') return undefined
    const a = currentNode.value.assignees[0]
    return a?.dept_code
  },
  set(val: string | undefined) {
    if (!currentNode.value || !val) return
    currentNode.value.assignees = [{
      type: 'role',
      code: 'committee_member',
      scope: 'specified',
      dept_code: val
    }]
    // 自动更新节点名称
    const committee = committeeOptions.value.find(c => c.value === val)
    if (committee) {
      currentNode.value.name = `${committee.label}会签`
    }
  }
})

// ---------- 节点类型切换 ----------

function onNodeTypeChange(newType: string) {
  if (!currentNode.value) return
  if (newType === 'approve') {
    currentNode.value.assignees = [{ type: 'dept_manager', scope: 'initiator_dept' }]
    currentNode.value.approve_mode = undefined
    currentNode.value.min_pass_count = undefined
    currentNode.value.name = '部门负责人审批'
  } else if (newType === 'countersign') {
    currentNode.value.assignees = []
    currentNode.value.approve_mode = 'all'
    currentNode.value.min_pass_count = 2
    currentNode.value.name = '委员会会签'
  }
}

// ---------- VueFlow 画布 ----------

const debouncedRemount = useDebounceFn(() => {
  vueFlowKey.value++
  emitUpdate()
}, 400)

watch(
  () => nodes.value.map(n => `${n.name}|${n.type}|${n.approve_mode}|${n.min_pass_count}|${n.assignees.length}|${JSON.stringify(n.assignees)}`).join(','),
  debouncedRemount
)

const NODE_GAP = 260

function buildFlowNodes(items: FlowNodeDef[]): VFNode[] {
  const result: VFNode[] = []

  result.push({
    id: 'start',
    type: 'startEnd',
    position: { x: 0, y: 40 },
    data: { label: '发起申请', type: 'start' },
    connectable: false,
    draggable: false
  })

  items.forEach((node, i) => {
    result.push({
      id: `node-${i}`,
      type: 'approvalStep',
      position: { x: (i + 1) * NODE_GAP, y: 10 },
      data: { ...node, index: i },
      connectable: false,
      draggable: false
    })
  })

  result.push({
    id: 'end',
    type: 'startEnd',
    position: { x: (items.length + 1) * NODE_GAP, y: 40 },
    data: { label: '流程结束', type: 'end' },
    connectable: false,
    draggable: false
  })

  return result
}

function buildFlowEdges(items: FlowNodeDef[]): VFEdge[] {
  const edges: VFEdge[] = []
  const style = { stroke: '#94a3b8', strokeWidth: 2 }
  const markerEnd = { type: MarkerType.ArrowClosed, color: '#94a3b8' }

  if (items.length === 0) {
    edges.push({ id: 'e-start-end', source: 'start', target: 'end', style, markerEnd })
    return edges
  }

  edges.push({ id: 'e-start-0', source: 'start', target: 'node-0', style, markerEnd })

  for (let i = 0; i < items.length - 1; i++) {
    edges.push({
      id: `e-${i}-${i + 1}`,
      source: `node-${i}`,
      target: `node-${i + 1}`,
      style,
      markerEnd
    })
  }

  edges.push({
    id: 'e-last-end',
    source: `node-${items.length - 1}`,
    target: 'end',
    style,
    markerEnd
  })

  return edges
}

const flowNodes = computed(() => buildFlowNodes(nodes.value))
const flowEdges = computed(() => buildFlowEdges(nodes.value))

// ---------- 节点操作 ----------

function onNodeClick({ node }: { node: VFNode }) {
  if (node.type === 'approvalStep') {
    const match = node.id.match(/node-(\d+)/)
    selectedIndex.value = match?.[1] !== undefined ? parseInt(match[1]) : null
  } else {
    selectedIndex.value = null
  }
}

function addNode() {
  if (nodes.value.length >= 10) return
  const idx = nodes.value.length
  nodes.value.push({
    name: DEFAULT_NAMES[idx] ?? `审批步骤${idx + 1}`,
    type: 'approve',
    assignees: [{
      type: idx === 0 ? 'dept_manager' : idx === 1 ? 'dept_leader' : 'initiator_leader',
      scope: 'initiator_dept'
    }]
  })
  selectedIndex.value = idx
  vueFlowKey.value++
  emitUpdate()
}

function removeNode() {
  if (selectedIndex.value === null) return
  nodes.value.splice(selectedIndex.value, 1)
  selectedIndex.value = nodes.value.length > 0
    ? Math.min(selectedIndex.value, nodes.value.length - 1)
    : null
  vueFlowKey.value++
  emitUpdate()
}

function moveNode(direction: -1 | 1) {
  if (selectedIndex.value === null) return
  const idx = selectedIndex.value
  const newIdx = idx + direction
  if (newIdx < 0 || newIdx >= nodes.value.length) return
  const tmp = nodes.value[idx]!
  nodes.value[idx] = nodes.value[newIdx]!
  nodes.value[newIdx] = tmp
  selectedIndex.value = newIdx
  vueFlowKey.value++
  emitUpdate()
}
</script>
