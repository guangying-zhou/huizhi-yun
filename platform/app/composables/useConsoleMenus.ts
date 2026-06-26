export type ConsoleMenuScope = 'public' | 'admin' | 'dashboard'

export interface ConsoleMenuItem {
  key: string
  label: string
  to: string
  icon?: string
  badge?: string
  disabled?: boolean
  requiredPermissions?: string[]
  requiredRoles?: string[]
  tenantScoped?: boolean
}

export interface ConsoleMenuGroup {
  group: string
  items: ConsoleMenuItem[]
}

export interface ConsoleMenuSection {
  title: string
  subtitle?: string
  items: ConsoleMenuItem[]
  groups?: ConsoleMenuGroup[]
}

export interface VisibleConsoleMenuOptions {
  hasPermission?: (permission: string) => boolean
  hasRole?: (roleCode: string) => boolean
  currentTenantCode?: string | null
}

type ConsoleMenuRegistry = Record<ConsoleMenuScope, ConsoleMenuSection>

function cloneSection(section: ConsoleMenuSection): ConsoleMenuSection {
  return {
    title: section.title,
    subtitle: section.subtitle,
    items: section.items.map(item => ({ ...item })),
    groups: section.groups?.map(group => ({
      group: group.group,
      items: group.items.map(item => ({ ...item }))
    }))
  }
}

function isVisible(item: ConsoleMenuItem, options: VisibleConsoleMenuOptions): boolean {
  if (item.tenantScoped && !String(options.currentTenantCode || '').trim()) {
    return false
  }

  if (item.requiredPermissions?.length && options.hasPermission) {
    const allowed = item.requiredPermissions.every(permission => options.hasPermission!(permission))
    if (!allowed) return false
  }

  if (item.requiredRoles?.length && options.hasRole) {
    const allowed = item.requiredRoles.some(roleCode => options.hasRole!(roleCode))
    if (!allowed) return false
  }

  return true
}

const defaultRegistry: ConsoleMenuRegistry = {
  public: {
    title: '公开入口',
    subtitle: 'Public',
    items: []
  },
  admin: {
    title: '运营控制台',
    subtitle: 'Admin',
    items: []
  },
  dashboard: {
    title: '租户工作台',
    subtitle: 'Dashboard',
    items: []
  }
}

const _useConsoleMenus = () => {
  const registry = useState<ConsoleMenuRegistry>('platform-console-menus', () => ({
    public: cloneSection(defaultRegistry.public),
    admin: cloneSection(defaultRegistry.admin),
    dashboard: cloneSection(defaultRegistry.dashboard)
  }))

  function getSection(scope: ConsoleMenuScope): ConsoleMenuSection {
    return registry.value[scope]
  }

  function getVisibleSection(scope: ConsoleMenuScope, options: VisibleConsoleMenuOptions = {}): ConsoleMenuSection {
    const section = getSection(scope)
    return {
      ...section,
      items: section.items.filter(item => isVisible(item, options)),
      groups: section.groups
        ?.map(group => ({
          group: group.group,
          items: group.items.filter(item => isVisible(item, options))
        }))
        .filter(group => group.items.length > 0)
    }
  }

  function setSection(scope: ConsoleMenuScope, section: ConsoleMenuSection) {
    registry.value = {
      ...registry.value,
      [scope]: cloneSection(section)
    }
  }

  function setItems(scope: ConsoleMenuScope, items: ConsoleMenuItem[]) {
    registry.value = {
      ...registry.value,
      [scope]: {
        ...registry.value[scope],
        items: items.map(item => ({ ...item }))
      }
    }
  }

  function resetSections() {
    registry.value = {
      public: cloneSection(defaultRegistry.public),
      admin: cloneSection(defaultRegistry.admin),
      dashboard: cloneSection(defaultRegistry.dashboard)
    }
  }

  return {
    registry,
    getSection,
    getVisibleSection,
    setSection,
    setItems,
    resetSections
  }
}

export const useConsoleMenus = createSharedComposable(_useConsoleMenus)
