/** UI guard only; the server still authorizes every document read and write. */
export function isPrivateUnsharedEditorCandidate({ hosted, docType, ownerUid, actorUid, sharesVerified, shareCount }) {
  return docType === 'private'
    && Boolean(actorUid)
    && actorUid === ownerUid
    && (!hosted || sharesVerified)
    && shareCount === 0
}

/** Start hint only: a fresh document read supplies the actor-specific ACL;
 * Collab still verifies access at session creation, handshake and revocation. */
export function canStartPrivateCollaboration({ docType, ownerUid, actorUid, aclVerified, readonlyFlag, sharesVerified, shareCount, accessWithdrawn }) {
  if (docType !== 'private' || !actorUid || !ownerUid || !aclVerified || readonlyFlag !== 0 || accessWithdrawn) return false
  return actorUid === ownerUid ? sharesVerified && shareCount > 0 : true
}
