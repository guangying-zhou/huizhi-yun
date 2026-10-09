const ACTIVE_WORKSPACE_ROOTS = new Set([
  'foundation',
  'platform',
  'aims',
  'workflow',
  'console',
  'webdev',
  'codocs',
  'collab',
  'align',
  'altoc',
  'assets',
  'finance',
  'people',
  'insights'
])

const FULL_WORKSPACE_CHECK_FILES = new Set([
  '.node-version',
  '.nvmrc',
  '.npmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml'
])

export const GO_MODULES = ['data-runtime', 'notification-runtime', 'dev-agent']

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '')
}

function workspaceRoot(path) {
  return normalizePath(path).split('/', 1)[0]
}

export function requiresFullWorkspaceCheck(changedFiles) {
  return changedFiles.some(file => FULL_WORKSPACE_CHECK_FILES.has(normalizePath(file)))
}

export function activeWorkspacePackages(workspacePackages) {
  return workspacePackages
    .filter(workspace => workspace.name && ACTIVE_WORKSPACE_ROOTS.has(workspaceRoot(workspace.path)))
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function affectedWorkspacePackageNames(changedFiles, workspacePackages) {
  const activePackages = activeWorkspacePackages(workspacePackages)
  if (requiresFullWorkspaceCheck(changedFiles)) {
    return activePackages.map(workspace => workspace.name)
  }

  const names = new Set()
  let hasUnownedActiveChange = false
  for (const rawFile of changedFiles) {
    const file = normalizePath(rawFile)
    if (!ACTIVE_WORKSPACE_ROOTS.has(workspaceRoot(file))) continue

    const owner = activePackages
      .filter(workspace => file === workspace.path || file.startsWith(`${workspace.path}/`))
      .sort((left, right) => right.path.length - left.path.length)[0]

    if (owner) names.add(owner.name)
    else hasUnownedActiveChange = true
  }

  if (hasUnownedActiveChange) return activePackages.map(workspace => workspace.name)
  return [...names].sort()
}

export function affectedGoModules(changedFiles, { forceFull = false } = {}) {
  if (forceFull) return [...GO_MODULES]

  return GO_MODULES.filter(moduleName => changedFiles.some((rawFile) => {
    const file = normalizePath(rawFile)
    return file === moduleName || file.startsWith(`${moduleName}/`)
  }))
}

export function isUsableDiffBase(base) {
  return Boolean(base && !/^0+$/.test(base))
}
