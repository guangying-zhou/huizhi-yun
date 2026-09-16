/**
 * Browser-facing Directory mutation payloads.
 *
 * Implementations live in tenant data-runtime.  This module intentionally
 * contains no database access and remains only as the shared BFF type contract.
 */
export interface DirectoryUserInput {
  uid?: unknown
  username?: unknown
  displayName?: unknown
  realName?: unknown
  nickname?: unknown
  avatarUrl?: unknown
  email?: unknown
  mobile?: unknown
  mobileTail4?: unknown
  positionTitle?: unknown
  gender?: unknown
  primaryDeptCode?: unknown
  userType?: unknown
  status?: unknown
  remark?: unknown
}

export interface DirectoryDepartmentInput {
  deptCode?: unknown
  name?: unknown
  deptName?: unknown
  parentDeptCode?: unknown
  managerId?: unknown
  leaderId?: unknown
  orgType?: unknown
  deptCategory?: unknown
  description?: unknown
  sortOrder?: unknown
  status?: unknown
}

export interface DirectoryCommitteeMemberInput {
  uid?: unknown
  role?: unknown
}

export interface DirectoryProjectInput {
  projectCode?: unknown
  name?: unknown
  projectName?: unknown
  parentProjectCode?: unknown
  projectType?: unknown
  deptCode?: unknown
  ownerUid?: unknown
  leaderUid?: unknown
  repoUrl?: unknown
  description?: unknown
  status?: unknown
  memberUids?: unknown
  members?: unknown
}
