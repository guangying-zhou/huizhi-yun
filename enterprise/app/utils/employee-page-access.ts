/** UI entry checks mirror existing manifest actions; object ACLs remain server-owned. */
export function employeePagePermission(path: string): { resource: string, action: string, anyActions?: string[] } | null {
  if (/^\/codocs\/mydocs(?:\/|$)/.test(path)) return { resource: 'documents', action: 'view' }
  if (/^\/codocs\/departments(?:\/|$)/.test(path)) return { resource: 'departments', action: 'view' }
  if (/^\/codocs\/company(?:\/|$)/.test(path)) return { resource: 'company', action: 'view' }
  if (/^\/aims\/admin\/projects(?:\/|$)/.test(path)) return { resource: 'admin', action: 'admin' }
  if (path === '/aims/projects' || path === '/aims/project-documents') return { resource: 'projects', action: 'view' }
  if (path === '/aims/admin/weekly-reporting-settings') return { resource: 'weekly_reports', action: 'configure' }
  if (path === '/aims/work-items') return { resource: 'work_items', action: 'view' }
  if (path === '/aims/weekly-reports') return { resource: 'weekly_reports', action: 'view' }
  if (path === '/aims/timesheet') return { resource: 'timesheet', action: 'view', anyActions: ['view', 'submit'] }
  if (path === '/aims/projects/new') return { resource: 'projects', action: 'create' }
  // Editors and shared links must use their exact server ACL, not a list role.
  return null
}
