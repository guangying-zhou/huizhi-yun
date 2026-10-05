export interface ConsoleBusinessDomain {
  domainCode: string
  domainName: string
  displayName: string
  aliasName: string | null
  category: string
  source: string
  sortOrder: number
}
export interface ConsoleRegion {
  regionCode: string
  regionName: string
  description: string | null
  sortOrder: number
  divisionCount: number
}
export interface ConsoleRegionDivision {
  divisionCode: string
  divisionName: string | null
  includeChildren: boolean
}
export interface ConsoleOrganizationRead {
  company: { companyCode: string, companyName: string }
  domains: ConsoleBusinessDomain[]
  regions: ConsoleRegion[]
}
