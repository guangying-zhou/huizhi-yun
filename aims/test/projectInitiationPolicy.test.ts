import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getProjectInitiationApplicabilityIssue,
  getProjectInitiationRepositoryIssue,
  PRODUCT_DEVELOPMENT_REPOSITORY_REQUIRED_MESSAGE,
  projectRequiresInitiation,
  ROUTINE_INITIATION_NOT_APPLICABLE_MESSAGE
} from '../app/utils/projectInitiationPolicy.ts'

describe('project initiation repository policy', () => {
  test('routine containers bypass project initiation entirely', () => {
    assert.equal(projectRequiresInitiation({ category: 'routine' }), false)
    assert.equal(
      getProjectInitiationApplicabilityIssue({ category: 'routine' }),
      ROUTINE_INITIATION_NOT_APPLICABLE_MESSAGE
    )
    assert.equal(projectRequiresInitiation({ category: 'custom_dev' }), true)
    assert.equal(getProjectInitiationApplicabilityIssue({ category: 'custom_dev' }), null)
  })

  test('blocks product development projects without a linked repository', () => {
    assert.equal(
      getProjectInitiationRepositoryIssue({ category: 'product_dev', repos: [] }),
      PRODUCT_DEVELOPMENT_REPOSITORY_REQUIRED_MESSAGE
    )
    assert.equal(
      getProjectInitiationRepositoryIssue({
        category: 'product_dev',
        repos: [{ repoProjectCode: ' ' }, { repo_project_code: null }]
      }),
      PRODUCT_DEVELOPMENT_REPOSITORY_REQUIRED_MESSAGE
    )
  })

  test('accepts camel-case and runtime snake-case repository relations', () => {
    assert.equal(
      getProjectInitiationRepositoryIssue({
        category: 'product_dev',
        repos: [{ repoProjectCode: 'huizhi-yun/huizhiyun' }]
      }),
      null
    )
    assert.equal(
      getProjectInitiationRepositoryIssue({
        category: 'product_dev',
        repos: [{ repo_project_code: 'huizhi-yun/huizhiyun' }]
      }),
      null
    )
  })

  test('does not require repositories for other project categories', () => {
    assert.equal(getProjectInitiationRepositoryIssue({ category: 'delivery', repos: [] }), null)
    assert.equal(getProjectInitiationRepositoryIssue({ category: 'custom_dev' }), null)
  })
})
