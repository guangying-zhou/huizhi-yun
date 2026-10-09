import { fileURLToPath } from 'node:url'

const page = (path, name, source) => ({ path, name, file: fileURLToPath(new URL(`./pages/${source}.vue`, import.meta.url)) })
export default Object.freeze({
  code: 'people', prefix: '/people', label: 'People',
  hostReadiness: { entryPath: '/employees', deferredPages: [] },
  handlers: [], tasks: [], objectWorkspaces: [],
  navigation: [
    { id: 'people.directory-recovery', area: 'people', group: 'employee', label: '目录投递与恢复', to: '/people/directory-recovery', permission: { resource: 'integration_operations', action: 'view' }, order: 50 },
    { id: 'people.offboarding.list', area: 'people', group: 'employee', label: '离职事项', to: '/people/offboarding', permission: { resource: 'offboarding_tasks', action: 'view' }, order: 40 },
    { id: 'people.hr-source', area: 'people', group: 'org', label: '人事事实源', to: '/people/settings/hr-source-sync', permission: { resource: 'hr_source_sync', action: 'view' }, order: 30 },
    { id: 'people.onboarding.list', area: 'people', group: 'employee', label: '入职候选', to: '/people/onboarding', permission: { resource: 'employees', action: 'view' }, order: 30 },
    { id: 'people.employee.list', area: 'people', group: 'employee', label: '员工', to: '/people/employees', permission: { resource: 'employees', action: 'view' }, order: 10 },
    { id: 'people.assignment.list', area: 'people', group: 'employee', label: '任职', to: '/people/assignments', permission: { resource: 'assignments', action: 'view' }, order: 20 },
    { id: 'people.position.list', area: 'people', group: 'org', label: '岗位', to: '/people/settings/positions', permission: { resource: 'positions', action: 'view' }, order: 10 },
    { id: 'people.rank.list', area: 'people', group: 'org', label: '职级', to: '/people/settings/ranks', permission: { resource: 'ranks', action: 'view' }, order: 20 },
    { id: 'people.standard-cost.list', area: 'people', group: 'cost', label: '职级工资设置', to: '/people/settings/standard-costs', permission: { resource: 'standard_costs', action: 'view' }, order: 10 }
  ],
  pages: [page('/directory-recovery', 'directory-recovery', 'directory-recovery'), page('/offboarding', 'offboarding', 'offboarding'), page('/offboarding/:id', 'offboarding-detail', 'offboarding-detail'), page('/settings/hr-source-sync', 'hr-source-sync', 'hr-source-sync'), page('/onboarding', 'onboarding', 'onboarding'), page('/employees', 'employees', 'employees'), page('/employees/:id', 'employee-detail', 'employee-detail'), page('/assignments', 'assignments', 'assignments'), page('/assignments/:id', 'assignment-detail', 'assignment-detail'), page('/settings/positions', 'positions', 'positions'), page('/settings/ranks', 'ranks', 'ranks'), page('/settings/standard-costs', 'standard-costs', 'standard-costs')]
})
