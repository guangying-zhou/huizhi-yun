export interface EnterpriseSession {
  refresh(): Promise<string>
  logout(): Promise<unknown>
}
declare module '#app' {
  interface NuxtApp { $enterpriseSession: EnterpriseSession }
}
export {}
