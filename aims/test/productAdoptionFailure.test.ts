import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  productAdoptionServiceFailure,
  productAdoptionTokenFailure,
  productAdoptionUpstreamReason,
  productAdoptionUpstreamStatus
} from '../server/utils/productAdoptionFailure.ts'

// h3 把 createError 的 data 序列化进响应体，serviceAppFetch 再把响应体挂到 error.data。
function assetsError(statusCode: number, message: string, reason?: string) {
  return {
    statusCode,
    message,
    data: { statusCode, message, ...(reason ? { data: { reason } } : {}) }
  }
}

describe('product adoption failure mapping', () => {
  test('只有原用户对象范围被拒才是用户可申请的 403', () => {
    const failure = productAdoptionServiceFailure(assetsError(403, '无权查看产品采用涉及的交付资产或环境', 'assets_object_scope_denied'))
    assert.equal(failure.statusCode, 403)
    assert.equal(failure.data.reason, 'assets_object_scope_denied')
    assert.match(failure.message, /deliveries:view/)
    assert.match(failure.message, /environments:view/)
  })

  test('服务身份、签名或来源应用被拒必须保持 503，不伪装成用户缺权', () => {
    for (const reason of ['product_adoption_service_identity_invalid', 'product_adoption_command_invalid']) {
      const failure = productAdoptionServiceFailure(assetsError(403, '产品采用查询的服务身份或部署绑定无效', reason))
      assert.equal(failure.statusCode, 503, reason)
      assert.equal(failure.data.reason, 'product_adoption_service_rejected', reason)
      assert.doesNotMatch(failure.message, /申请|配置 Assets/)
    }
    const unauthorized = productAdoptionServiceFailure(assetsError(401, '缺少服务令牌'))
    assert.equal(unauthorized.statusCode, 503)
    assert.equal(unauthorized.data.reason, 'product_adoption_service_rejected')
  })

  test('没有原因码的 403 不会被当成对象范围拒绝', () => {
    const failure = productAdoptionServiceFailure(assetsError(403, 'Forbidden'))
    assert.equal(failure.statusCode, 503)
    assert.equal(failure.data.reason, 'product_adoption_service_rejected')
  })

  test('其他失败与无效响应保持通用 503', () => {
    for (const cause of [assetsError(500, 'boom'), assetsError(502, 'bad gateway'), null, undefined, 'oops']) {
      const failure = productAdoptionServiceFailure(cause)
      assert.equal(failure.statusCode, 503)
      assert.equal(failure.data.reason, 'product_adoption_service_unavailable')
    }
  })

  test('令牌签发失败保持可重试 503，且不外泄 Console 诊断串', () => {
    const failure = productAdoptionTokenFailure()
    assert.equal(failure.statusCode, 503)
    assert.equal(failure.data.reason, 'product_adoption_token_unavailable')
    assert.doesNotMatch(failure.message, /Console service token request failed|http/i)
  })

  test('原因码与状态码从两种错误形状中读取', () => {
    assert.equal(productAdoptionUpstreamReason({ data: { reason: 'assets_object_scope_denied' } }), 'assets_object_scope_denied')
    assert.equal(productAdoptionUpstreamReason({ data: { data: { reason: 'assets_object_scope_denied' } } }), 'assets_object_scope_denied')
    assert.equal(productAdoptionUpstreamReason({}), '')
    assert.equal(productAdoptionUpstreamStatus({ statusCode: 403 }), 403)
    assert.equal(productAdoptionUpstreamStatus({ response: { status: 401 } }), 401)
    assert.equal(productAdoptionUpstreamStatus({ statusCode: 99 }), 0)
    assert.equal(productAdoptionUpstreamStatus(null), 0)
  })

  test('Assets 在三个 403 出口都带稳定原因码', () => {
    const files = {
      '../../assets/server/utils/productAdoptionAuthorization.ts': 'assets_object_scope_denied',
      '../../assets/server/utils/productAdoptionServiceAuth.ts': 'product_adoption_service_identity_invalid',
      '../../assets/server/utils/productAdoptionService.ts': 'product_adoption_command_invalid'
    }
    for (const [file, reason] of Object.entries(files)) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      assert.ok(source.includes(`reason: '${reason}'`), `${file} 缺少原因码 ${reason}`)
    }
  })

  test('采用页只在对象范围被拒时提示申请权限', () => {
    const page = readFileSync(new URL('../app/pages/products/[productCode]/adoption.vue', import.meta.url), 'utf8')
    assert.ok(page.includes('reason === \'assets_object_scope_denied\''), '页面未按原因码判定')
    assert.ok(page.includes('需要 Assets 交付资产与环境的查看范围'), '缺少可执行提示')
  })
})
