import {createEnterpriseEntitlementStateRepository} from '../../server/utils/enterpriseEntitlementState.ts'
import {readFile} from 'node:fs/promises'
import {createApp,defineEventHandler,toWebHandler} from 'h3'
import assert from 'node:assert/strict'
import {createEnterpriseOrderApprovalRepository} from '../../server/utils/enterpriseOrderApproval.ts'
import {confirmEnterpriseOrderPayment} from '../../server/utils/enterpriseOrderFulfillment.ts'

export async function testEnterpriseApprovedOrder({rootDir,pool,withTransaction}) {
  // Called after technical fixture setup and before catalog drift scenarios.
  await pool.query('ALTER TABLE platform_orders MODIFY id BIGINT AUTO_INCREMENT, ADD placed_at DATETIME, ADD notes VARCHAR(1000), ADD created_at DATETIME')
  await pool.query("INSERT INTO tenants (tenant_code,status) VALUES ('quoted-new','active')")
  const ddl=await readFile(`${rootDir}/platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql`,'utf8')
  for(const table of ['platform_accounts','platform_roles','platform_resources','platform_role_permissions','platform_account_roles']) {
    const sql=ddl.match(new RegExp('CREATE TABLE IF NOT EXISTS `'+table+'` \\([\\s\\S]*?\\) ENGINE[^;]+;'))?.[0]
    assert.ok(sql)
    await pool.query(sql.split('\n').filter(line=>!/^\s*(CONSTRAINT|FOREIGN KEY|REFERENCES|ON DELETE|ON UPDATE)\b/.test(line)).join('\n').replace(/,\s*\) ENGINE/,'\n) ENGINE'))
  }
  const {ensureOpsRbacReady}=await import('../../server/utils/platformOpsRbac.ts')
  await ensureOpsRbacReady(['ops-fixture'])
  const createHandler=(await import('../../server/api/platform/ops/subscriptions/orders/approved.post.ts')).default
  const acceptHandler=(await import('../../server/api/platform/tenant-admin/enterprise-orders/accept.post.ts')).default
  const invoke=async(handler,context,body)=>{
    const app=createApp().use(defineEventHandler(event=>{Object.assign(event.context,context);return handler(event)}))
    const response=await toWebHandler(app)(new Request('http://fixture.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))
    return {status:response.status,body:await response.json()}
  }
  const repo=createEnterpriseOrderApprovalRepository(withTransaction)
  const input={tenantCode:'quoted-new',requestId:'fixture-approved-quote',approvalReference:'SIGNED-QUOTE-FIXTURE',effectiveFrom:'2026-09-01T00:00:00Z',effectiveUntil:'2027-03-15T00:00:00Z',amount:'123.45',currency:'CNY',actorUid:'ops-fixture'}
  const {actorUid,...createBody}=input
  assert.equal((await invoke(createHandler,{platformUid:actorUid,platformAccessScope:'tenant-admin'},createBody)).status,403)
  assert.equal((await invoke(createHandler,{platformUid:'unprivileged',platformAccessScope:'ops'},createBody)).status,403)
  const responses=await Promise.all([invoke(createHandler,{platformUid:actorUid,platformAccessScope:'ops'},createBody),invoke(createHandler,{platformUid:actorUid,platformAccessScope:'ops'},createBody)])
  for (const response of responses) assert.equal(response.status,200,JSON.stringify(response.body))
  const created=responses.map(response=>response.body.data)
  assert.equal(created.filter(r=>r.replayed).length,1)
  await assert.rejects(repo.create({...input,amount:'124.00'}),/idempotency_conflict/)
  const order=created[0]
  const confirm={tenantCode:input.tenantCode,orderId:order.orderId,actorUid:'ops-fixture',accountId:null,bankTransactionNo:'FIXTURE-TRANSFER',paidAt:new Date().toISOString()}
  await assert.rejects(confirmEnterpriseOrderPayment(confirm),/acceptance_required/)
  await assert.rejects(repo.accept({tenantCode:'provision-b',orderNo:order.orderNo,actorUid:'owner-b'}),/not_found/)
  const owner={platformTenantCode:input.tenantCode,platformUid:'owner-new',platformAccessScope:'tenant-admin',platformTenantMembership:{isOwner:true}}
  assert.equal((await invoke(acceptHandler,{...owner,platformTenantMembership:{isOwner:false}},{orderNo:order.orderNo})).status,403)
  assert.equal((await invoke(acceptHandler,owner,{orderNo:order.orderNo,amount:'1.00'})).status,400)
  const acceptance=await invoke(acceptHandler,owner,{orderNo:order.orderNo})
  assert.equal(acceptance.status,200,JSON.stringify(acceptance.body))
  const accepted=acceptance.body.data
  assert.equal(accepted.replayed,false)
  assert.equal((await repo.accept({tenantCode:input.tenantCode,orderNo:order.orderNo,actorUid:'owner-new'})).replayed,true)
  const paid=await confirmEnterpriseOrderPayment(confirm)
  assert.equal(paid.entitlement.end.effectiveUntil,'2027-03-15T00:00:00.000Z')
  assert.equal((await confirmEnterpriseOrderPayment(confirm)).replayed,true)
  await pool.execute("INSERT INTO deployment_sites (tenant_code,site_code,site_name,public_url,root_app_code,environment) VALUES (?,?,?,'https://fixture.invalid','enterprise','test')",[input.tenantCode,input.tenantCode,input.tenantCode])
  const {startOnboarding}=await import('../../server/utils/onboardingFlow.ts')
  const opened=await startOnboarding({tenantCode:input.tenantCode,planCode:'enterprise-full',environment:'test',generateBundle:false})
  assert.equal(JSON.parse(opened.license.signedToken).payload.expiresAt,paid.entitlement.end.effectiveUntil)
  assert.equal(opened.subscriptions.length,2)
  const before=(await pool.execute('SELECT * FROM enterprise_order_approvals WHERE order_id=?',[order.orderId]))[0][0]
  await pool.execute('UPDATE platform_orders SET total_amount=124 WHERE id=?',[order.orderId])
  await assert.rejects(confirmEnterpriseOrderPayment(confirm),/source_conflict/)
  assert.deepEqual((await pool.execute('SELECT * FROM enterprise_order_approvals WHERE order_id=?',[order.orderId]))[0][0],before)
  await pool.query("CREATE TRIGGER fail_enterprise_approval BEFORE INSERT ON enterprise_order_approvals FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture_approval_failure'")
  const count=Number((await pool.query('SELECT COUNT(*) n FROM platform_orders'))[0][0].n)
  await assert.rejects(repo.create({...input,requestId:'rollback'}),/fixture_approval_failure/)
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM platform_orders'))[0][0].n),count)
  await pool.query('DROP TRIGGER fail_enterprise_approval')
  await pool.execute('UPDATE platform_orders SET total_amount=123.45 WHERE id=?',[order.orderId])
  await createEnterpriseEntitlementStateRepository(withTransaction).change({tenantCode:input.tenantCode,operationId:'quote-pause',expectedRevision:1,action:'suspend',actorUid:'ops-fixture',reason:'fixture'},new Date().toISOString())
  const renewal=await repo.create({...input,requestId:'approved-renewal',approvalReference:'RENEWAL-FIXTURE',effectiveFrom:input.effectiveUntil,effectiveUntil:'2027-07-01T00:00:00Z'})
  await repo.accept({tenantCode:input.tenantCode,orderNo:renewal.orderNo,actorUid:'owner-new'})
  const renewed=await confirmEnterpriseOrderPayment({...confirm,orderId:renewal.orderId,bankTransactionNo:'FIXTURE-RENEWAL'})
  assert.equal(renewed.entitlement.status,'suspended')
  assert.equal(renewed.entitlement.end.effectiveUntil,'2027-07-01T00:00:00.000Z')
  await assert.rejects(startOnboarding({tenantCode:input.tenantCode,planCode:'enterprise-full',environment:'test',generateBundle:false}),/qualification_inactive/)

  console.log('Approved enterprise order: immutable approval, concurrent create, tenant acceptance, exact payment/qualification/onboarding and audit failure rollback passed.')
}
