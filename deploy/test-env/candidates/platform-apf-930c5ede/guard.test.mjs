import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
for(const script of ['snapshot.mjs','switch.mjs','api.mjs'])test(`${script} refuses before host, credential, DB or network access without release approval`,()=>{
 const r=spawnSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),'preview'],{env:{PATH:process.env.PATH},encoding:'utf8'})
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/stopped/);assert.doesNotMatch(r.stderr,/password|Bearer|mysql:\/\//)
})
test('database script refuses without approval before defaults read or mysql execution',()=>{
 const r=spawnSync('bash',[fileURLToPath(new URL('database.sh',import.meta.url)),'backup'],{env:{PATH:process.env.PATH},encoding:'utf8'})
 assert.equal(r.status,64);assert.equal(r.stdout,'');assert.equal(r.stderr,'')
})
import fs from 'node:fs'
const plan=JSON.parse(fs.readFileSync(new URL('roles-plan.json',import.meta.url)))
test('role plan is pinned to test and exact declared manifest actions',()=>{
 assert.equal(plan.tenant,'C000001');assert.equal(plan.environment,'test');assert.equal(plan.subjectCode,'test')
 for(const r of plan.roles){
  const app=r.appRoleCode.split(':')[0]
  const manifest=JSON.parse(fs.readFileSync(new URL(`../../../../${app}/app.manifest.json`,import.meta.url)))
  const declared=manifest.recommendedRoles.find(x=>x.code===r.appRoleCode)
  assert.deepEqual(r.permissions,declared.suggestedPermissions)
  assert.equal(r.proposedManualTenantScopes.length,app==='workflow'?0:r.permissions.length)
  for(const s of r.proposedManualTenantScopes){assert.ok(r.permissions.includes(`${s.appCode}:${s.resourceCode}:${s.action}`));assert.equal(s.scopeType,'tenant');assert.equal(s.scopeValue,'global');assert.equal(s.status,'active')}
 }
})
test('cashier and reconciliation remain separate stages, specialists get no maker role',()=>{
 assert.deepEqual(plan.phases.receipt_payment_confirm,['finance:cashier'])
 assert.deepEqual(plan.phases.reconciliation,['finance:reconciliation_operator'])
 for(const code of ['finance:invoice_issuer','finance:invoice_approver','finance:expense_approver']){
  assert.ok(plan.roles.find(r=>r.appRoleCode===code).permissions.every(p=>!p.endsWith(':admin')&&!p.endsWith(':edit')))
 }
})
