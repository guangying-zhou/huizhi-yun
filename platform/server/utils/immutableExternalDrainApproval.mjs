import { createHash } from 'node:crypto'

const sha256 = text => createHash('sha256').update(text).digest('hex')
function fail(code) {
  throw Error(`external_drain_${code}`)
}

// The unique generation key also guards concurrent inserts when the SELECT sees no row.
export async function immutableExternalDrainApproval(tx, { tenant, environment, cutoverKey, generation, revision,
  requestId, sealPayloadSha256, actorUid, approvalReference, payload, apply, signArtifact }) {
  const existing = await tx.queryRow(`SELECT request_id,payload_sha256,artifact_json FROM enterprise_external_drain_approvals
    WHERE tenant_code=? AND environment=? AND cutover_key=? AND target_generation=? FOR UPDATE`,
  [tenant, environment, cutoverKey, generation])
  const payloadSha256 = sha256(payload)
  if (existing) {
    if (existing.request_id !== requestId || existing.payload_sha256 !== payloadSha256 || !existing.artifact_json) fail('immutable_approval_conflict')
    const artifact = typeof existing.artifact_json === 'string' ? JSON.parse(existing.artifact_json) : existing.artifact_json
    if (artifact.payload !== payload) fail('immutable_approval_conflict')
    return { applied: !!apply, replayed: true, payloadSha256, ...artifact }
  }
  if (!apply) return { applied: false, replayed: false, payload, payloadSha256 }
  const artifact = await signArtifact(payload)
  await tx.execute(`INSERT INTO enterprise_external_drain_approvals
    (tenant_code,environment,cutover_key,target_generation,seal_revision,seal_payload_sha256,request_id,payload_sha256,payload_json,artifact_json,actor_uid,approval_reference)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  [tenant, environment, cutoverKey, generation, revision, sealPayloadSha256, requestId, payloadSha256, payload,
    JSON.stringify(artifact), actorUid, approvalReference])
  return { applied: true, replayed: false, payloadSha256, ...artifact }
}
