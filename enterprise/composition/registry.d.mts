export interface BusinessPage { path: string, name: string, file: string, children?: BusinessPage[] }
export interface PermissionRef { resource: string, action: string }
export interface BusinessNavigationItem { id: string, label: string, icon?: string, to?: string, module?: string, permission?: PermissionRef, permissionRefs?: readonly PermissionRef[], mode?: 'all' | 'any', access?: { kind: 'authenticated-self' }, children?: BusinessNavigationItem[] }
export interface BusinessNavigationArea { id: string, code: string, label: string, icon: string, children: BusinessNavigationItem[] }
export interface BusinessAreaShape { code: string, label: string, icon: string, groups: { code: string, label: string }[] }
export interface ObjectWorkspaceItem { id: string, label: string, path: string, module: string, permission: PermissionRef }
export interface ObjectWorkspace { code: string, label: string, base: string, backTo: string, backLabel: string, actions?: { id: string, module?: string, permission: PermissionRef }[], groups: { id: string, label: string, items: ObjectWorkspaceItem[] }[] }
export interface BusinessModule {
  code: string
  prefix: string
  label: string
  pages: BusinessPage[]
  handlers: unknown[]
  tasks: unknown[]
  hostReadiness?: { entryPath?: string, deferredPages?: readonly string[] }
  navigation?: readonly { id: string, area: string, group: string, label: string, to: string, permission?: PermissionRef, permissionRefs?: readonly PermissionRef[], mode?: 'all' | 'any', order?: number }[]
  objectWorkspaces?: readonly ObjectWorkspace[]
}
export interface HostNavigationContributor {
  code: string
  label: string
  hostNavigation: { schemaVersion: number, placement: 'host-native', pages: readonly string[], entries: readonly { id: string, area: string, group: string, label: string, to: string, order?: number, access: { kind: 'authenticated-self' } | ({ kind: 'permission' } & PermissionRef) }[] }
}
export interface HostNativePage { path: string, name: string, file: string, module: string }
export const navigationContributors: readonly (BusinessModule | HostNavigationContributor)[]
export const hostNativePages: readonly HostNativePage[]
export const navigationSources: readonly { appCode: string, manifestHash: string }[]
export const businessModules: readonly BusinessModule[]
export function registerBusinessPages(existing: { path: string, name?: string }[], modules: readonly BusinessModule[], placeholderFile: string): (BusinessPage & { meta: { logicalModule: string, moduleLabel: string, moduleEntryPath: string } })[]
export function buildBusinessNavigation(modules: readonly (BusinessModule | HostNavigationContributor)[], areas: readonly BusinessAreaShape[], auxiliary: readonly BusinessAreaShape[], nativePages?: readonly HostNativePage[]): { primary: BusinessNavigationArea[], auxiliary: BusinessNavigationArea[] }
export function buildObjectWorkspaces(modules: readonly BusinessModule[]): ObjectWorkspace[]
