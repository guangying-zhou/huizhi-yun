/** UI guard only; the server still authorizes every document read and write. */
export function isPrivateUnsharedEditorCandidate({ hosted, docType, ownerUid, actorUid, sharesVerified, shareCount }) {
  return docType === 'private'
    && Boolean(actorUid)
    && actorUid === ownerUid
    && (!hosted || sharesVerified)
    && shareCount === 0
}
