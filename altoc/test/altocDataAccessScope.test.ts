import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildAltocDepartmentTreeCodeIndex,
  resolveAltocDataAccessQueryFromScopedGrants
} from '../server/utils/altocDataAccessScope.ts'

const appCode = 'altoc'

function grant(input: {
  resource?: string
  action?: string
  scopes?: Array<Record<string, unknown>>
  defaultScopes?: Array<Record<string, unknown>>
  assignmentScopes?: Array<Record<string, unknown>>
}) {
  return {
    grantId: 'assignment:1:sales',
    roleCode: 'sales',
    source: 'assignment',
    permissions: [{
      appCode,
      resourceCode: input.resource || 'customer',
      action: input.action || 'view'
    }],
    scopes: input.scopes || [],
    defaultScopes: input.defaultScopes || [],
    assignmentScopes: input.assignmentScopes || []
  }
}

function resolve(input: {
  grants?: ReturnType<typeof grant>[]
  currentDeptCodes?: string[]
  resource?: string
  action?: string
  hasGlobalAdminRole?: boolean
  departmentTreeCodesByRoot?: Record<string, string[]>
}) {
  return resolveAltocDataAccessQueryFromScopedGrants({
    appCode,
    grants: input.grants || [],
    currentDeptCodes: input.currentDeptCodes || [],
    resource: input.resource || 'customer',
    action: input.action || 'view',
    hasGlobalAdminRole: input.hasGlobalAdminRole,
    departmentTreeCodesByRoot: input.departmentTreeCodesByRoot
  })
}

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('Altoc scoped authorization data access conversion', () => {
  test('global admin role converts to all even without scoped grants', () => {
    assert.deepEqual(resolve({ hasGlobalAdminRole: true }), {
      current_user_altoc_access: 'all',
      current_user_data_access: 'all'
    })
  })

  test('tenant global or no object scope converts to all', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        scopes: [{ dimension: 'tenant', predicate: 'global' }]
      })]
    }), {
      current_user_altoc_access: 'all',
      current_user_data_access: 'all'
    })
  })

  test('subject self scope converts to self', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        scopes: [{ dimension: 'subject', predicate: 'self' }]
      })]
    }), {
      current_user_altoc_access: 'self',
      current_user_data_access: 'self'
    })
  })

  test('explicit department scopes convert to dept query parameters with deduped codes', () => {
    assert.deepEqual(resolve({
      grants: [
        grant({ scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a' }] }),
        grant({ scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-b' }] }),
        grant({ scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a' }] })
      ]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-a,dept-b',
      current_user_data_dept_codes: 'dept-a,dept-b'
    })
  })

  test('department self without value resolves from current Console department codes', () => {
    assert.deepEqual(resolve({
      currentDeptCodes: ['dept-sales', 'dept-delivery'],
      grants: [grant({
        scopes: [{ dimension: 'department', predicate: 'self' }]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-sales,dept-delivery',
      current_user_data_dept_codes: 'dept-sales,dept-delivery'
    })
  })

  test('department tree with explicit value expands descendants from Console directory tree', () => {
    const departmentTreeCodesByRoot = buildAltocDepartmentTreeCodeIndex([{
      deptCode: 'dept-root',
      children: [{
        deptCode: 'dept-sales',
        children: [{ deptCode: 'dept-sales-east' }]
      }, {
        deptCode: 'dept-delivery'
      }]
    }])

    assert.deepEqual(resolve({
      departmentTreeCodesByRoot,
      grants: [grant({
        scopes: [{ dimension: 'department', predicate: 'tree', value: 'dept-root' }]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-root,dept-sales,dept-sales-east,dept-delivery',
      current_user_data_dept_codes: 'dept-root,dept-sales,dept-sales-east,dept-delivery'
    })
  })

  test('department tree with explicit value but no directory index keeps root only', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        scopes: [{ dimension: 'department', predicate: 'tree', value: 'dept-root' }]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-root',
      current_user_data_dept_codes: 'dept-root'
    })
  })

  test('department tree without explicit value does not fall back to current departments', () => {
    assert.deepEqual(resolve({
      currentDeptCodes: ['dept-sales'],
      grants: [grant({
        scopes: [{ dimension: 'department', predicate: 'tree' }]
      })]
    }), {
      current_user_altoc_access: 'none',
      current_user_data_access: 'none'
    })
  })

  test('unsupported scoped grant does not downgrade to self access', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        scopes: [{ dimension: 'region', predicate: 'self', value: 'north' }]
      })]
    }), {
      current_user_altoc_access: 'none',
      current_user_data_access: 'none'
    })
  })

  test('same dimension department scopes combine explicit tree and current self departments', () => {
    assert.deepEqual(resolve({
      currentDeptCodes: ['dept-sales'],
      grants: [grant({
        scopes: [
          { dimension: 'department', predicate: 'tree', value: 'dept-root' },
          { dimension: 'department', predicate: 'self' }
        ]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-root,dept-sales',
      current_user_data_dept_codes: 'dept-root,dept-sales'
    })
  })

  test('default and assignment department scopes intersect inside one grant', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        defaultScopes: [
          { dimension: 'department', predicate: 'self', value: 'dept-a' },
          { dimension: 'department', predicate: 'self', value: 'dept-b' }
        ],
        assignmentScopes: [
          { dimension: 'department', predicate: 'self', value: 'dept-b' },
          { dimension: 'department', predicate: 'self', value: 'dept-c' }
        ]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-b',
      current_user_data_dept_codes: 'dept-b'
    })
  })

  test('default and assignment department tree scopes intersect after descendant expansion', () => {
    const departmentTreeCodesByRoot = buildAltocDepartmentTreeCodeIndex([{
      deptCode: 'dept-root',
      children: [
        { deptCode: 'dept-a' },
        {
          deptCode: 'dept-b',
          children: [{ deptCode: 'dept-b-sub' }]
        }
      ]
    }])

    assert.deepEqual(resolve({
      departmentTreeCodesByRoot,
      grants: [grant({
        defaultScopes: [
          { dimension: 'department', predicate: 'tree', value: 'dept-root' }
        ],
        assignmentScopes: [
          { dimension: 'department', predicate: 'tree', value: 'dept-b' }
        ]
      })]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-b,dept-b-sub',
      current_user_data_dept_codes: 'dept-b,dept-b-sub'
    })
  })

  test('subject and department scopes inside one grant convert to self and department intersection', () => {
    assert.deepEqual(resolve({
      currentDeptCodes: ['dept-sales'],
      grants: [grant({
        scopes: [
          { dimension: 'subject', predicate: 'self' },
          { dimension: 'department', predicate: 'self' }
        ]
      })]
    }), {
      current_user_altoc_access: 'self_dept',
      current_user_data_access: 'self_dept',
      current_user_altoc_dept_codes: 'dept-sales',
      current_user_data_dept_codes: 'dept-sales'
    })
  })

  test('default subject scope and assignment department scope convert to self and department intersection', () => {
    assert.deepEqual(resolve({
      grants: [grant({
        defaultScopes: [{ dimension: 'subject', predicate: 'self' }],
        assignmentScopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a' }]
      })]
    }), {
      current_user_altoc_access: 'self_dept',
      current_user_data_access: 'self_dept',
      current_user_altoc_dept_codes: 'dept-a',
      current_user_data_dept_codes: 'dept-a'
    })
  })

  test('separate self and department grants still combine as broad dept mode', () => {
    assert.deepEqual(resolve({
      grants: [
        grant({ scopes: [{ dimension: 'subject', predicate: 'self' }] }),
        grant({ scopes: [{ dimension: 'department', predicate: 'self', value: 'dept-a' }] })
      ]
    }), {
      current_user_altoc_access: 'dept',
      current_user_data_access: 'dept',
      current_user_altoc_dept_codes: 'dept-a',
      current_user_data_dept_codes: 'dept-a'
    })
  })

  test('missing matching permission converts to none', () => {
    assert.deepEqual(resolve({
      grants: [grant({ resource: 'contract', action: 'view' })]
    }), {
      current_user_altoc_access: 'none',
      current_user_data_access: 'none'
    })
  })

  test('current resolver loads Console directory tree for department tree expansion', () => {
    const content = source('server/utils/altocScopedAuthorization.ts')

    assert.match(content, /fetchDirectoryApi<[\s\S]+>\('\/api\/v1\/directory\/departments'\)/)
    assert.match(content, /buildAltocDepartmentTreeCodeIndex\(extractDepartmentTree\(response\)\)/)
    assert.match(content, /departmentTreeCodesByRoot/)
    assert.match(content, /scopedGrantsNeedDepartmentTree\(scoped\.grants\)/)
  })
})
