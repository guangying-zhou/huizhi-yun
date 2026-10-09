// Physical applications only. Aims remains a business domain after retirement.
function localApplications(profile) {
  return ['gateway', 'enterprise', 'codocs-editor',
    ...(profile.identity?.consoleFacadeMode === 'local-canonical-facade' ? ['console'] : []),
    ...(profile.features?.codocsCollaborationV2 === true ? ['collab'] : []),
    ...(profile.features?.workflowLocal === true ? ['workflow', ...(profile.features?.aimsRetired === true ? [] : ['aims'])] : [])]
}

module.exports = { localApplications }
