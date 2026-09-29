import type { HostNativePage, HostNavigationContributor } from './registry.mjs'

export function projectHostNativePages(contributor: HostNavigationContributor): HostNativePage[]
export function annotateHostNativePageAuthorization(existing: { path: string, file?: string, meta?: Record<string, unknown>, children?: unknown[] }[], projection: readonly HostNativePage[]): void
export function validateHostNativePages(existing: readonly { path: string, file?: string, children?: readonly unknown[] }[], projection: readonly HostNativePage[]): void
