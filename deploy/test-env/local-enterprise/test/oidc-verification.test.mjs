import assert from 'node:assert/strict'
import test from 'node:test'
import { localOidcVerification } from '../oidc-verification.mjs'
const clients = [{id: 12,app_code:'enterprise',client_type:'public',auth_mode:'oidc',status:'active'}]
const callbacks = [['redirect','https://hzy0.isme.dev/enterprise/api/auth/oidc-callback']]
const uri = {client_id:12,uri_type:'redirect',redirect_uri:callbacks[0][1],status:'active'}
test('callback must belong to the exact active Enterprise client',()=>{
  assert.equal(localOidcVerification(clients,[uri],callbacks).callbacks[0].active,true)
  for (const rows of [[{...uri,client_id:13}],[{...uri,status:'inactive'}],[]]) assert.equal(localOidcVerification(clients,rows,callbacks).callbacks[0].active,false)
  for (const rows of [[],[{...clients[0],status:'inactive'}],[...clients,...clients]]) assert.equal(localOidcVerification(rows,[uri],callbacks).callbacks[0].active,false)
})
