import type { ProjectCategory, ProjectConfidentialityLevel, ProjectSecurityLevel } from './aims'

export interface AdminProject {
  id: number
  projectCode: string
  name: string
  shortName: string | null
  internalCode: string | null
  description: string | null
  category: ProjectCategory
  lifecycleStatus: string
  methodology: string
  portfolioId: number | null
  domainCode: string | null
  deptCode: string | null
  leaderUid: string | null
  startDate: string | null
  endDate: string | null
  securityLevel: ProjectSecurityLevel
  confidentialityLevel: ProjectConfidentialityLevel
  accessWhitelist: string[] | null
  counts?: { members: number, milestones: number, workItems: number }
  editVersion: string
}
