import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workflowProxyErrorData } from '../server/utils/workflowProxyError.ts'

test('preserves a Workflow H3 business error across the application proxy', () => {
  assert.deepEqual(
    workflowProxyErrorData({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '驳回意见必填',
        data: {
          code: 'comment_required',
          message: '驳回意见必填',
          upstreamStatus: 400
        }
      }
    }),
    {
      statusCode: 400,
      statusMessage: 'Bad Request',
      code: 'comment_required',
      message: '驳回意见必填',
      upstreamStatus: 400
    }
  )
})

test('does not expose an internal upstream 5xx response', () => {
  assert.deepEqual(
    workflowProxyErrorData({
      status: 500,
      data: { message: 'database host 10.0.0.8 failed' }
    }),
    {
      statusCode: 503,
      statusMessage: 'Workflow unavailable',
      code: 'workflow_upstream_unavailable',
      message: 'Workflow 服务暂时不可用',
      upstreamStatus: 500
    }
  )
})
