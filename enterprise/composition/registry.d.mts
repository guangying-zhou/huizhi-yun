export interface BusinessPage { path: string; name: string; file: string; children?: BusinessPage[] }
export interface BusinessNavigationItem { label: string; icon?: string; to?: string; children?: BusinessNavigationItem[] }
export interface BusinessNavigationArea { code: string; label: string; icon: string; children: BusinessNavigationItem[] }
export interface BusinessAreaShape { code: string; label: string; icon: string; groups: { code: string; label: string }[] }
export interface ObjectWorkspaceItem { label: string; path: string }
export interface ObjectWorkspace { code: string; label: string; base: string; backTo: string; backLabel: string; groups: { label: string; items: ObjectWorkspaceItem[] }[] }
export interface BusinessModule {
  code: string
  prefix: string
  label: string
  pages: BusinessPage[]
  handlers: unknown[]
  tasks: unknown[]
  hostReadiness?: { entryPath?: string, deferredPages?: readonly string[] }
  navigation?: readonly { area: string; group: string; label: string; to: string; order?: number }[]
  objectWorkspaces?: readonly ObjectWorkspace[]
}
export const businessModules: readonly BusinessModule[]
export function registerBusinessPages(existing: { path: string; name?: string }[], modules: readonly BusinessModule[], placeholderFile: string): (BusinessPage & { meta: { logicalModule: string; moduleLabel: string; moduleEntryPath: string } })[]
export function buildBusinessNavigation(modules: readonly BusinessModule[], areas: readonly BusinessAreaShape[], auxiliary: readonly BusinessAreaShape[]): { primary: BusinessNavigationArea[]; auxiliary: BusinessNavigationArea[] }
export function buildObjectWorkspaces(modules: readonly BusinessModule[]): ObjectWorkspace[]
