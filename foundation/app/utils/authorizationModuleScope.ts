import type { InjectionKey } from 'vue'

/** Build-time composition only. Never populate this scope from route/query/user data. */
export const authorizationModuleScope: InjectionKey<'altoc' | 'finance'> = Symbol('authorization-module-scope')
