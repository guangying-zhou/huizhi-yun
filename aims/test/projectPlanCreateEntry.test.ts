import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const filename = new URL('../app/pages/projects/[id]/plan.vue', import.meta.url).pathname
const source = readFileSync(filename, 'utf8')
const { descriptor, errors } = parse(source, { filename })

test('project milestone page compiles as a complete SFC, including the populated creation toolbar', () => {
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'project-plan-create-entry' })
  const template = compileTemplate({ filename, id: 'project-plan-create-entry', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})

type Node = { type: number, tag?: string, props?: Array<{ type: number, name: string, value?: { content: string }, exp?: { content: string }, arg?: { content: string } }>, children?: Node[] }
const directive = (node: Node, name: string) => node.props?.find(prop => prop.type === 7 && prop.name === name)

test('empty and populated milestone branches both expose the original leader-gated create action', () => {
  const entries: { node: Node, ancestors: Node[], label: string }[] = []
  function visit(node: Node, ancestors: Node[] = []) {
    const label = node.props?.find(prop => prop.type === 6 && prop.name === 'label')?.value?.content
    if (node.tag === 'UButton' && ['创建里程碑', '新建里程碑'].includes(label || '')) entries.push({ node, ancestors, label: label! })
    for (const child of node.children || []) visit(child, [...ancestors, node])
  }
  visit(descriptor.template!.ast as Node)
  assert.equal(entries.length, 2)
  const empty = entries.find(entry => entry.label === '创建里程碑')!
  const populated = entries.find(entry => entry.label === '新建里程碑')!
  assert.ok(empty.ancestors.some(node => directive(node, 'else-if')?.exp?.content === 'milestoneStore.milestones.length === 0'))
  assert.ok(populated.ancestors.some(node => directive(node, 'else')))
  for (const entry of entries) {
    assert.ok([entry.node, ...entry.ancestors].some(node => directive(node, 'if')?.exp?.content === 'isProjectLeader'), `${entry.label} must use the existing project-leader guard`)
    const click = entry.node.props?.find(prop => prop.type === 7 && prop.name === 'on' && prop.arg?.content === 'click')
    assert.equal(click?.exp?.content, 'showCreateMilestoneModal = true')
  }
  assert.match(source, /async function handleCreateMilestone\(\) \{\s*if \(!isProjectLeader\.value\)/)
})

test('manual milestone creation excludes periodic while existing template periodic remains visible but legacy close is blocked', () => {
  assert.match(source, /const createModeOptions = modeOptions\.filter\(option => option\.value !== 'periodic'\)/)
  assert.match(source, /createMilestoneForm\.value\.mode === 'periodic'[\s\S]*?周期里程碑只能通过模板创建/)
  assert.match(source, /createMilestoneForm\.value\.mode !== 'periodic'/)
  assert.match(source, /:items="createModeOptions"/)
  assert.match(source, /:items="modeOptions"/)
  assert.match(source, /milestone\.mode === 'periodic'[\s\S]*?Boolean\(milestone\.templateKey\)/)
  assert.match(source, /milestone\.mode === 'periodic' && !milestone\.templateKey"[\s\S]*?无法关期，请迁至模板/)
})

test('Host plan commands retain an intent key until success or the dialog is abandoned', () => {
  const store = readFileSync(new URL('../app/stores/milestone.ts', import.meta.url), 'utf8')
  assert.match(store, /createCommandIntents\(\)/)
  for (const action of ['create', 'update', 'delete']) {
    assert.match(store, new RegExp('`' + action + ':\\$\\{(?:projectId|id)\\}`'))
    assert.match(store, /headers: intents\.headers\(action/)
  }
  assert.match(store, /intents\.complete\(action\)/)
  assert.match(source, /if \(!open\) milestoneStore\.abandonMilestoneIntent\('create', projectId\.value\)/)
  assert.match(source, /if \(!open && editingMilestoneId\.value\) milestoneStore\.abandonMilestoneIntent\('update', editingMilestoneId\.value\)/)
  assert.match(source, /headers: deliverableIntents\.headers\(action, body\)/)
  assert.match(source, /deliverableIntents\.complete\(action\)/)
})
