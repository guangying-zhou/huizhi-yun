import type { ResourceActionPolicy } from './index.ts'

export interface AuthorizationActionGoldenCase {
  id: string
  grantedActions: string[]
  requiredAction: string
  policy?: ResourceActionPolicy
  expected: boolean
}

/** Core、Console、Foundation 必须共同执行的动作判定契约。 */
export const AUTHORIZATION_ACTION_GOLDEN_CASES: AuthorizationActionGoldenCase[] = [
  { id: 'exact-view', grantedActions: ['view'], requiredAction: 'view', expected: true },
  { id: 'edit-implies-view', grantedActions: ['edit'], requiredAction: 'view', expected: true },
  { id: 'view-does-not-imply-edit', grantedActions: ['view'], requiredAction: 'edit', expected: false },
  { id: 'admin-implies-edit', grantedActions: ['admin'], requiredAction: 'edit', expected: true },
  { id: 'admin-does-not-imply-approve', grantedActions: ['admin'], requiredAction: 'approve', expected: false },
  { id: 'admin-does-not-imply-confirm', grantedActions: ['admin'], requiredAction: 'confirm', expected: false },
  { id: 'admin-does-not-imply-export', grantedActions: ['admin'], requiredAction: 'export', expected: false },
  { id: 'admin-does-not-imply-close', grantedActions: ['admin'], requiredAction: 'close', expected: false },
  { id: 'admin-does-not-imply-deploy', grantedActions: ['admin'], requiredAction: 'deploy', expected: false },
  {
    id: 'manifest-execute-implies-view',
    grantedActions: ['execute'],
    requiredAction: 'view',
    policy: { implications: { execute: ['view'] } },
    expected: true
  },
  {
    id: 'manifest-admin-implies-execute-not-deploy',
    grantedActions: ['admin'],
    requiredAction: 'deploy',
    policy: { implications: { admin: ['view', 'edit', 'execute'] } },
    expected: false
  },
  {
    id: 'manifest-wildcard-is-explicit',
    grantedActions: ['admin'],
    requiredAction: 'approve',
    policy: { implications: { admin: ['*'] } },
    expected: true
  }
]
