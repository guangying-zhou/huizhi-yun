export interface ConsoleDirectoryUser {
  id: number
  uid: string
  username?: string | null
  displayName?: string | null
  realName: string | null
  nickname: string | null
  email: string | null
  mobile: string | null
  mobileTail4?: string | null
  avatar: string | null
  gender: number
  status?: number
  deptCode: string | null
  deptName: string | null
  positionTitle?: string | null
  userType?: string
}

export interface ConsoleDirectoryDepartment {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: string | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  sortOrder?: number
  description?: string | null
  children: ConsoleDirectoryDepartment[]
}

export interface ConsoleDirectoryProject {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string | null
  ownerUid?: string | null
  leaderUid: string | null
  description: string | null
  status: number
  statusKey?: string
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  subProjects: ConsoleDirectoryProject[]
}

export interface ConsoleDirectoryProjectMember {
  id: number
  projectCode: string
  uid: string
  role: string
  status: string
  displayName: string
  realName: string | null
  email: string | null
  mobileTail4: string | null
  primaryDeptCode: string | null
  deptName: string | null
  joinedAt: string
}

export type ConsoleCommitteeStatus = 'active' | 'inactive' | 'deleted'
export type ConsoleCommitteeMemberRole = 'leader' | 'manager' | 'member' | 'observer'

export interface ConsoleDirectoryCommittee {
  id: number
  committeeCode: string
  name: string
  parentDeptCode: string | null
  parentDeptName: string | null
  managerUid: string | null
  managerName: string | null
  leaderUid: string | null
  leaderName: string | null
  description: string | null
  sortOrder: number
  status: ConsoleCommitteeStatus
  memberCount: number
  createdAt: string
  updatedAt: string
}

export interface ConsoleDirectoryCommitteeMember {
  id: number
  uid: string
  role: ConsoleCommitteeMemberRole
  sourceProvider: string
  joinedAt: string | null
  status: string
  displayName: string
  realName: string | null
  avatar: string | null
  email: string | null
  positionTitle: string | null
  userStatus: string
  primaryDeptCode: string | null
  deptName: string | null
}

export interface ConsoleDirectorySelfProfile {
  uid: string
  username: string | null
  displayName: string
  realName: string
  email: string
  avatar: string | null
  deptCode: string | null
  deptName: string | null
  nickname?: string | null
  mobileTail4?: string | null
  positionTitle?: string | null
  userType?: string | null
}
