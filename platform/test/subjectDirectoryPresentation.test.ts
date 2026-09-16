import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { omitProjectSubjects } from '../app/utils/subjectDirectoryPresentation.ts'

describe('subject directory presentation', () => {
  test('omits project subjects while preserving real jobs', () => {
    const subjects = [
      { id: 1, subjectType: 'department', subjectCode: 'GMO', externalRef: null, parentSubjectId: null },
      { id: 2, subjectType: 'project', subjectCode: 'huizhi-yun/aims', externalRef: 'project-ref', parentSubjectId: 1 },
      { id: 3, subjectType: 'job', subjectCode: 'developer', externalRef: 'job-ref', parentSubjectId: 1 },
      { id: 4, subjectType: 'user', subjectCode: 'u-1', externalRef: null, parentSubjectId: 1 }
    ]

    assert.deepEqual(omitProjectSubjects(subjects), [
      subjects[0],
      subjects[2],
      subjects[3]
    ])
  })

  test('also omits disabled legacy job shadows after project resync', () => {
    const subjects = [
      { id: 1, subjectType: 'job', subjectCode: 'huizhi-yun/aims', externalRef: 'same-ref', parentSubjectId: null },
      { id: 2, subjectType: 'project', subjectCode: 'huizhi-yun/aims', externalRef: 'same-ref', parentSubjectId: null },
      { id: 3, subjectType: 'job', subjectCode: 'huizhi-yun/aims', externalRef: 'real-job-ref', parentSubjectId: null }
    ]

    assert.deepEqual(omitProjectSubjects(subjects), [subjects[2]])
  })
})
