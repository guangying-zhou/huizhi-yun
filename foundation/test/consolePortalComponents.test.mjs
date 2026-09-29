import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createSSRApp, defineComponent, h, ref, computed, watch, onMounted, onScopeDispose } from 'vue'
import { renderToString } from '@vue/server-renderer'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
async function page(path) {
  const result = await build({
    entryPoints: [new URL(path, root).pathname], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], define: { 'import.meta.client': 'false' },
    plugins: [{ name: 'shared-portal-sfc', setup(builder) {
      builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
        const { descriptor, errors } = parse(readFileSync(path, 'utf8'), { filename: path })
        assert.deepEqual(errors, [])
        if (descriptor.script || descriptor.scriptSetup) {
          return { contents: compileScript(descriptor, { id: path, inlineTemplate: true }).content, loader: 'ts' }
        }
        const template = compileTemplate({ source: descriptor.template.content, filename: path, id: path })
        assert.deepEqual(template.errors, [])
        return { contents: `${template.code}\nexport default { render }`, loader: 'ts' }
      })
    } }]
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  return module.exports.default
}

test('both apps render the same Foundation notification and todo components with their own routes and headers', async () => {
  const sources = [
    ['console/app/pages/notifications/index.vue', false, 'notifications'],
    ['console/app/pages/notifications/[notificationId].vue', false, 'detail'],
    ['console/app/pages/todos/index.vue', false, 'todos'],
    ['enterprise/app/pages/enterprise/notifications/index.vue', true, 'notifications'],
    ['enterprise/app/pages/enterprise/notifications/[notificationId].vue', true, 'detail'],
    ['enterprise/app/pages/enterprise/todos.vue', true, 'todos']
  ]
  const state = { error: '', loading: false, items: [] }
  const mocks = {
    ref, computed, watch, onMounted, onScopeDispose, definePageMeta: () => {},
    usePageTitle: () => {},
    useRoute: () => ({ params: { notificationId: 'notice-1' }, query: {} }),
    useRouter: () => ({ push: async () => {}, replace: async () => {} }),
    useListPage: () => ({ page: ref(1), pageSize: 20 }),
    useToast: () => ({ add: () => {} }),
    useUserApplications: () => ({ apps: ref([]), loadApps: async () => {} }),
    useNotifications: () => ({
      cacheFingerprint: ref('actor-policy'), pageItems: ref(state.items), pageTotal: ref(state.items.length), pageLoading: ref(state.loading), pageError: ref(state.error), loadNotificationPage: async () => null,
      items: ref(state.items), summary: ref({ unreadCount: 2 }), loading: ref(state.loading), error: ref(state.error),
      status: ref('all'), nextCursor: ref(null), loadSummary: async () => {}, loadNotifications: async () => {},
      loadMore: async () => {}, loadDetail: async () => {}, markRead: async () => {}, archive: async () => {}, markAllRead: async () => {}
    })
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, mocks)
  const Panel = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.header?.(), slots.body?.()]) })
  const Navbar = defineComponent({ props: ['title'], setup: (props, { slots }) => () => h('nav', [props.title, slots.leading?.(), slots.right?.()]) })
  const Box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()]) })
  const Button = defineComponent({ props: ['label', 'to'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, [props.label, slots.default?.()]) })
  // Nuxt auto-registers Foundation components through extends; the isolated
  // renderer installs those same implementations for template-only Host pages.
  const shared = {
    NotificationCenter: await page('foundation/app/components/NotificationCenter.vue'),
    TodoList: await page('foundation/app/components/TodoList.vue')
  }
  async function render(component) {
    const app = createSSRApp(component)
    for (const [name, component] of Object.entries(shared)) app.component(name, component)
    app.component('UDashboardPanel', Panel).component('UDashboardNavbar', Navbar).component('UButton', Button)
    app.component('CommonEmptyState', defineComponent({ props: ['title', 'description'], setup: props => () => h('p', [props.title, props.description]) }))
    app.component('UTable', defineComponent({
      props: ['data', 'columns', 'loading'],
      setup: (props, { slots }) => () => h('table', props.loading
        ? [h('tbody', { 'data-loading': 'true' })]
        : props.data.length
          ? props.data.map(item => h('tr', props.columns.map(column => slots[`${column.accessorKey || column.id}-cell`]?.({ row: { original: item } }))))
          : slots.empty?.())
    }))
    for (const name of ['UBadge', 'UIcon', 'UCard', 'UAlert', 'UDashboardSidebarCollapse']) app.component(name, Box)
    return await renderToString(app)
  }
  try {
    for (const [path, hosted, kind] of sources) {
      state.items = []
      const component = await page(path)
      const html = await render(component)
      assert.match(html, kind === 'todos' ? /当前没有待处理事项/ : /消息中心/)
      if (hosted) {
        assert.match(html, /<h1[^>]*>(消息中心|我的待办)<\/h1>/)
        assert.doesNotMatch(html, /<nav/)
      } else assert.match(html, /<nav/)
      if (kind === 'detail') assert.ok(html.includes(`href="${hosted ? '/enterprise' : ''}/notifications"`), 'mobile back link must stay in its app')
      if (kind === 'notifications') {
        state.error = 'read unavailable'
        assert.match(await render(component), /消息列表暂时不可用/)
        state.error = ''
        state.loading = true
        assert.match(await render(component), /data-loading="true"/)
        state.loading = false
        state.items = [{ notificationId: 'notice-1', displayLabel: '可见消息', severity: 'info', sourceAppCode: 'aims', category: 'due', createdAt: '', recipient: { isRead: false } }]
        assert.match(await render(component), /可见消息/)
      }
    }
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('shared portal routing never copies Console components, changes detail authorization or replaces idempotent writes', () => {
  assert.equal(existsSync(new URL('console/app/components/NotificationCenter.vue', root)), false)
  for (const file of ['NotificationCenter', 'TodoList']) {
    const component = read(`foundation/app/components/${file}.vue`)
    assert.doesNotMatch(component, /from ['"]~|\/api\/v1\/console\//)
    assert.match(component, /ContentPageHeader/)
  }
  const center = read('foundation/app/components/NotificationCenter.vue')
  assert.match(center, /await router\.push\(props\.detailPath\(item\.notificationId\)\)/)
  assert.match(center, /await router\.push\(props\.listPath\)/)
  assert.match(center, /await markRead\(notificationId\)/)
  assert.match(center, /await archive\(item\.notificationId\)/)
  assert.match(center, /await markAllRead\(\)/)
  const todos = read('foundation/app/components/TodoList.vue')
  assert.match(todos, /props\.apiPath/)
  assert.ok(todos.indexOf('await loadDetail(item.notificationId)') < todos.indexOf('await markRead(item.notificationId)'))
  assert.ok(todos.indexOf('await markRead(item.notificationId)') < todos.indexOf('await navigateTo(actionUrl'))
  for (const path of ['notifications/index.vue', 'notifications/[notificationId].vue', 'todos.vue']) {
    assert.doesNotMatch(read(`enterprise/app/pages/enterprise/${path}`), /foundation\/app\/components/)
  }
  const host = read('enterprise/app/layouts/default.vue')
  assert.match(host, /view-all-path="\/enterprise\/notifications"/)
  assert.match(read('enterprise/app/pages/index.vue'), /to="\/enterprise\/todos"/)
})

test('org profile fields are shared by Console and Host and Host hides editing', async () => {
  const previous = globalThis.computed
  globalThis.computed = computed
  try {
    const component = await page('foundation/app/components/OrgProfileDetails.vue')
    const app = createSSRApp(component, { profile: { tenantCode: 'T1', orgName: '测试企业', countryCode: 'CN', contactName: '联系人', status: 'active' } })
    app.component('UCard', defineComponent({ setup: (_, { slots }) => () => h('div', [slots.header?.(), slots.default?.()]) }))
    const html = await renderToString(app)
    assert.match(html, /测试企业/)
    assert.match(html, /联系人/)
    for (const path of ['console/app/pages/org-profile.vue', 'enterprise/app/pages/enterprise/org-profile.vue']) assert.match(read(path), /<OrgProfileDetails/)
    const host = read('enterprise/app/pages/enterprise/org-profile.vue')
    assert.match(host, /ContentPageHeader\s+hosted/)
    assert.match(host, /CommonEmptyState\s+v-if="forbidden"/)
    assert.match(host, /在控制台编辑/)
    assert.doesNotMatch(host, /saveProfile|editDraft|method: 'PUT'/)
    assert.match(read('console/app/pages/org-profile.vue'), /method: 'PUT'/)
  } finally { globalThis.computed = previous }
})

test('users read page shares the Console table and renders data, empty and forbidden states', async () => {
  const state = { rows: [], error: null, total: 0 }
  const mocks = {
    ref, computed,
    usePageTitle: () => {},
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {}, reset: () => {} }),
    useListPage: () => ({ page: ref(1), pageSize: 20, resetFilters: () => {} }),
    useFetch: async () => ({ data: ref({ code: 0, data: { items: state.rows, total: state.total } }), pending: ref(false), error: ref(state.error), refresh: async () => {}, execute: async () => {}, clear: () => {} })
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('foundation/app/components/DirectoryUsersReadPage.vue')
    const sharedTable = await page('foundation/app/components/DirectoryUsersTable.vue')
    async function render() {
      const app = createSSRApp(component, { apiPath: '/enterprise/api/directory/users', consolePath: '/console/directory/users' })
      const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.default?.(), slots.actions?.()]) })
      app.component('DirectoryUsersTable', sharedTable)
      app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => props.data.length ? h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) : slots.empty?.() }))
      app.component('UButton', defineComponent({ props: ['to', 'label'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, props.label || slots.default?.()) }))
      app.component('CommonEmptyState', defineComponent({ props: ['title'], setup: props => () => h('p', props.title) }))
      app.component('ContentPageHeader', defineComponent({ props: ['title'], setup: props => () => h('h1', props.title) }))
      for (const name of ['UDashboardPanel', 'UInput', 'USelect', 'UBadge', 'UAvatar', 'UPagination', 'USlideover', 'UAlert', 'USkeleton']) app.component(name, box)
      return renderToString(app)
    }
    assert.match(await render(), /暂无目录用户/)
    state.rows = [{ uid: 'U1', realName: '可见员工', email: 'work@example.test', status: 1 }]
    state.total = 1
    assert.match(await render(), /可见员工/)
    state.error = { statusCode: 403 }
    const forbidden = await render()
    assert.match(forbidden, /无权限/)
    assert.doesNotMatch(forbidden, /可见员工/)
    assert.match(read('console/app/pages/directory/users.vue'), /<DirectoryUsersTable/)
    const host = read('foundation/app/components/DirectoryUsersReadPage.vue')
    assert.doesNotMatch(host, /initialPassword|activation|provisioning|method:\s*['"](?:POST|PATCH|PUT|DELETE)/)
    assert.match(host, /clearDetail\(\)/)
    assert.match(host, /debounced\.value/)
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('shared department table keeps Host read-only and Console edit actions', async () => {
  const component = await page('foundation/app/components/DirectoryDepartmentsTable.vue')
  async function render(readOnly) {
    const app = createSSRApp(component, { items: [{ deptCode: 'D1', name: '研发部', children: [], displayLevel: 0 }], loading: false, expandedCodes: new Set(), readOnly })
    app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: props => () => h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) }))
    app.component('UButton', defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }))
    app.component('UBadge', defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }))
    return renderToString(app)
  }
  const host = await render(true)
  assert.match(host, /研发部/)
  assert.match(host, /查看/)
  assert.doesNotMatch(host, /编辑|删除/)
  assert.match(await render(false), /编辑/)
  assert.match(read('console/app/pages/directory/departments.vue'), /<DirectoryDepartmentsTable/)
  assert.doesNotMatch(read('foundation/app/components/DirectoryDepartmentsReadPage.vue'), /method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
})

test('shared project table keeps Host read-only and Console edit actions', async () => {
  const component = await page('foundation/app/components/DirectoryProjectsTable.vue')
  async function render(readOnly) {
    const app = createSSRApp(component, { items: [{ projectCode: 'P1', name: '测试项目', status: 1, isGroup: 0, isTemplate: 0 }], loading: false, expandedCodes: new Set(), readOnly })
    app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: props => () => h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) }))
    app.component('UButton', defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }))
    app.component('UBadge', defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }))
    return renderToString(app)
  }
  const host = await render(true)
  assert.match(host, /测试项目/)
  assert.match(host, /查看/)
  assert.doesNotMatch(host, /编辑|删除/)
  assert.match(await render(false), /编辑/)
  assert.match(read('console/app/pages/directory/projects.vue'), /<DirectoryProjectsTable/)
  assert.doesNotMatch(read('foundation/app/components/DirectoryProjectsReadPage.vue'), /method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
})

test('projects read page shares the Console table and renders data, empty and forbidden states', async () => {
  const state = { rows: [], error: null, total: 0 }
  const mocks = {
    ref, computed, watch: () => {},
    usePageTitle: () => {},
    useRoute: () => ({ fullPath: '/enterprise/directory/projects' }),
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {}, reset: () => {} }),
    useListPage: () => ({ page: ref(1), pageSize: 20, resetFilters: () => {} }),
    useFetch: async () => ({ data: ref({ code: 0, data: { flat: state.rows, total: state.total } }), pending: ref(false), error: ref(state.error), refresh: async () => {}, execute: async () => {}, clear: () => {} })
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('foundation/app/components/DirectoryProjectsReadPage.vue')
    const sharedTable = await page('foundation/app/components/DirectoryProjectsTable.vue')
    async function render() {
      const app = createSSRApp(component, { apiPath: '/enterprise/api/directory/projects', consolePath: '/console/directory/projects' })
      const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.default?.(), slots.actions?.()]) })
      app.component('DirectoryProjectEditor', defineComponent({ setup: (_, { slots }) => () => slots.default?.({ members: () => {}, saving: false }) }))
      app.component('DirectoryProjectsTable', sharedTable)
      app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => props.data.length ? h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) : slots.empty?.() }))
      app.component('UButton', defineComponent({ props: ['to', 'label'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, props.label || slots.default?.()) }))
      app.component('CommonEmptyState', defineComponent({ props: ['title'], setup: props => () => h('p', props.title) }))
      app.component('ContentPageHeader', defineComponent({ props: ['title'], setup: props => () => h('h1', props.title) }))
      for (const name of ['UDashboardPanel', 'UInput', 'USelect', 'UBadge', 'UAvatar', 'UPagination', 'USlideover', 'UAlert', 'USkeleton']) app.component(name, box)
      return renderToString(app)
    }
    assert.match(await render(), /暂无项目注册/)
    state.rows = [{ projectCode: 'P1', name: '可见项目', status: 1, isGroup: 0, isTemplate: 0 }]
    state.total = 1
    assert.match(await render(), /可见项目/)
    state.error = { statusCode: 403 }
    const forbidden = await render()
    assert.match(forbidden, /无权限/)
    assert.doesNotMatch(forbidden, /可见项目/)
    assert.match(read('console/app/pages/directory/projects.vue'), /<DirectoryProjectsTable/)
    const host = read('foundation/app/components/DirectoryProjectsReadPage.vue')
    assert.doesNotMatch(host, /initialPassword|activation|provisioning|method:\s*['"](?:POST|PATCH|PUT|DELETE)/)
    assert.match(host, /clearDetail\(\)/)
    assert.match(host, /debounced\.value/)
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('shared committee table keeps Host read-only and Console edit actions', async () => {
  const component = await page('foundation/app/components/DirectoryCommitteesTable.vue')
  async function render(readOnly) {
    const app = createSSRApp(component, { items: [{ committeeCode: 'C1', name: '测试委员会', status: 'active', memberCount: 2 }], loading: false, canEdit: !readOnly })
    app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: props => () => h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) }))
    app.component('UButton', defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }))
    app.component('UBadge', defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }))
    return renderToString(app)
  }
  const host = await render(true)
  assert.match(host, /测试委员会/)
  assert.match(host, /查看/)
  assert.doesNotMatch(host, /编辑|删除/)
  assert.match(await render(false), /编辑/)
  assert.match(read('console/app/pages/directory/committees.vue'), /<DirectoryCommitteesTable/)
  assert.doesNotMatch(read('foundation/app/components/DirectoryCommitteesReadPage.vue'), /method:\s*['"](?:POST|PUT|PATCH|DELETE)/)
})

test('committees read page shares the Console table and renders data, empty and forbidden states', async () => {
  const state = { rows: [], error: null, total: 0 }
  const mocks = {
    ref, computed, watch: () => {},
    usePageTitle: () => {},
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {}, reset: () => {} }),
    useListPage: () => ({ page: ref(1), pageSize: 20, resetFilters: () => {} }),
    useFetch: async () => ({ data: ref({ code: 0, data: { items: state.rows, total: state.total } }), pending: ref(false), error: ref(state.error), refresh: async () => {}, execute: async () => {}, clear: () => {} })
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('foundation/app/components/DirectoryCommitteesReadPage.vue')
    const sharedTable = await page('foundation/app/components/DirectoryCommitteesTable.vue')
    async function render() {
      const app = createSSRApp(component, { apiPath: '/enterprise/api/directory/committees', consolePath: '/console/directory/committees' })
      const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.default?.(), slots.actions?.()]) })
      app.component('DirectoryCommitteeEditor', defineComponent({ setup: (_, { slots }) => () => slots.default?.({ members: () => {}, saving: false }) }))
      app.component('DirectoryCommitteesTable', sharedTable)
      app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => props.data.length ? h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', column.cell ? column.cell({ row: { original } }) : original[column.accessorKey]))))) : slots.empty?.() }))
      app.component('UButton', defineComponent({ props: ['to', 'label'], setup: (props, { slots }) => () => h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, props.label || slots.default?.()) }))
      app.component('CommonEmptyState', defineComponent({ props: ['title'], setup: props => () => h('p', props.title) }))
      app.component('ContentPageHeader', defineComponent({ props: ['title'], setup: props => () => h('h1', props.title) }))
      for (const name of ['UDashboardPanel', 'UInput', 'USelect', 'UBadge', 'UAvatar', 'UPagination', 'USlideover', 'UAlert', 'USkeleton']) app.component(name, box)
      return renderToString(app)
    }
    assert.match(await render(), /暂无委员会/)
    state.rows = [{ committeeCode: 'C1', name: '可见委员会', status: 'active', memberCount: 2 }]
    state.total = 1
    assert.match(await render(), /可见委员会/)
    state.error = { statusCode: 403 }
    const forbidden = await render()
    assert.match(forbidden, /无权限/)
    assert.doesNotMatch(forbidden, /可见委员会/)
    assert.match(read('console/app/pages/directory/committees.vue'), /<DirectoryCommitteesTable/)
    const host = read('foundation/app/components/DirectoryCommitteesReadPage.vue')
    assert.doesNotMatch(host, /initialPassword|activation|provisioning|method:\s*['"](?:POST|PATCH|PUT|DELETE)/)
    assert.match(read('foundation/app/components/DirectoryCommitteeEditor.vue'), /members\.value = \[\]/)
    assert.match(host, /debounced\.value/)
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('shared committee member table hides role editing and removal by default', async () => {
  const component = await page('foundation/app/components/DirectoryCommitteeMembersTable.vue')
  async function render(canEdit) {
    const app = createSSRApp(component, { items: [{ uid: 'U1', displayName: '测试委员', userStatus: 'active', role: 'member', joinedAt: '2026-01-01', deptName: '研发部' }], canEdit })
    app.component('UTable', defineComponent({ props: ['data', 'columns'], setup: (props, { slots }) => () => h('table', props.data.map(original => h('tr', props.columns.map(column => h('td', slots[`${column.accessorKey || column.id}-cell`]?.({ row: { original } }) || original[column.accessorKey]))))) }))
    app.component('UButton', defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }))
    app.component('UBadge', defineComponent({ setup: (_, { slots }) => () => h('span', slots.default?.()) }))
    app.component('UAvatar', defineComponent({ setup: () => () => h('span') }))
    app.component('USelect', defineComponent({ setup: () => () => h('select') }))
    return renderToString(app)
  }
  const host = await render(false)
  assert.match(host, /测试委员/)
  assert.match(host, /委员/)
  assert.doesNotMatch(host, /移除|<select/)
  const editable = await render(true)
  assert.match(editable, /移除/)
  assert.match(editable, /<select/)
  assert.match(read('foundation/app/components/DirectoryCommitteeEditor.vue'), /<DirectoryCommitteeMembersTable/)
})

test('Host personal profile uses only the current directory record and shared read-only fields', async () => {
  const state = { profile: null, error: null, pending: false }
  const calls = []
  const mocks = {
    ref, computed, definePageMeta: () => {}, usePageTitle: () => {}, resolveAvatarSrc: value => value,
    sharedApiPath: path => `/enterprise/api/foundation${path.slice('/api'.length)}`,
    useFetch: async (path, options) => {
      calls.push({ path, options })
      return { data: ref({ code: 0, data: state.profile }), pending: ref(state.pending), error: ref(state.error), refresh: async () => {} }
    }
  }
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, mocks)
  try {
    const component = await page('enterprise/app/pages/enterprise/profile.vue')
    const details = await page('foundation/app/components/DirectorySelfProfileDetails.vue')
    async function render() {
      const app = createSSRApp(component)
      const box = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.default?.(), slots.actions?.()]) })
      app.component('DirectorySelfProfileDetails', details)
      app.component('UButton', defineComponent({ props: ['to', 'label'], setup: props => () => h('a', { href: typeof props.to === 'string' ? props.to : props.to?.path }, props.label) }))
      app.component('CommonEmptyState', defineComponent({ props: ['title'], setup: props => () => h('p', props.title) }))
      app.component('UAlert', defineComponent({ props: ['title'], setup: props => () => h('p', props.title) }))
      for (const name of ['UDashboardPanel', 'ContentPageHeader', 'UCard', 'UAvatar', 'USkeleton']) app.component(name, box)
      return renderToString(app)
    }
    assert.match(await render(), /暂无个人资料/)
    state.profile = { uid: 'U-self', realName: '本人姓名', displayName: '本人姓名', email: 'self@example.test', deptCode: 'D1', deptName: '本人部门', positionTitle: '工程师' }
    const html = await render()
    assert.match(html, /U-self/)
    assert.match(html, /本人姓名/)
    assert.match(html, /本人部门/)
    assert.match(html, /工程师/)
    assert.match(html, /href="\/console\/profile"/)
    for (const [statusCode, title] of [[401, '请登录'], [403, '无权限'], [503, '个人资料加载失败']]) {
      state.error = { statusCode }
      const errorHtml = await render()
      assert.match(errorHtml, new RegExp(title))
      assert.doesNotMatch(errorHtml, /本人姓名|U-self/)
    }
    for (const call of calls) {
      assert.equal(call.path, '/enterprise/api/foundation/directory/me')
      assert.equal(call.options, undefined)
    }
    const host = read('enterprise/app/pages/enterprise/profile.vue')
    assert.doesNotMatch(host, /useAuth|useRoute|method:|passwordForm|uploadAvatar|\/api\/directory\/users/)
    assert.match(read('console/app/pages/profile.vue'), /<DirectorySelfProfileDetails/)
    assert.match(read('console/app/pages/profile.vue'), /uploadAvatar/)
  } finally {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
