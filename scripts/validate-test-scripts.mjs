#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEST_FILE_PATTERN = /\.(?:test|spec)\.(?:js|ts|jsx|tsx)$/
const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
])

function usage() {
  return `
Usage:
  node scripts/validate-test-scripts.mjs
  node scripts/validate-test-scripts.mjs --workspace-list-file <path>
  node scripts/validate-test-scripts.mjs --package-dir <path> [--package-dir <path> ...]

Checks packages recursively for .test/.spec JS, TS, JSX, and TSX files. Packages
with tests must define scripts.test, and packages defining scripts.test must have
at least one test file. Generated output and dependency directories are ignored.

--workspace-list-file accepts pnpm list --json output and is intended for
temporary fixture validation.

--package-dir validates one or more explicit package roots without pnpm workspace
discovery. Repeat the option to validate multiple independent packages.
`
}

function parseArguments(argv) {
  const options = { packageDirs: [], workspaceListFile: undefined }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--help' || argument === '-h') {
      console.info(usage().trim())
      process.exit(0)
    }

    if (argument === '--workspace-list-file') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--workspace-list-file requires a path')
      }
      options.workspaceListFile = resolve(process.cwd(), value)
      index += 1
      continue
    }

    if (argument === '--package-dir') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--package-dir requires a path')
      }
      options.packageDirs.push(resolve(process.cwd(), value))
      index += 1
      continue
    }

    throw new Error(`unknown argument: ${argument}`)
  }

  if (options.workspaceListFile && options.packageDirs.length > 0) {
    throw new Error('--workspace-list-file and --package-dir cannot be used together')
  }

  return options
}

function parseWorkspaceList(content, source) {
  let workspacePackages

  try {
    workspacePackages = JSON.parse(content)
  } catch (error) {
    throw new Error(`${source} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!Array.isArray(workspacePackages)) {
    throw new Error(`${source} must contain a JSON array`)
  }

  return workspacePackages
}

function loadWorkspacePackages(workspaceListFile) {
  if (workspaceListFile) {
    if (!existsSync(workspaceListFile)) {
      throw new Error(`workspace list fixture is missing: ${workspaceListFile}`)
    }
    return parseWorkspaceList(readFileSync(workspaceListFile, 'utf8'), workspaceListFile)
  }

  const result = spawnSync('pnpm', ['list', '-r', '--depth', '-1', '--json'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`pnpm workspace discovery failed: ${result.stderr.trim() || `exit code ${result.status}`}`)
  }

  return parseWorkspaceList(result.stdout, 'pnpm workspace discovery')
}

function isAccountWorkspace(workspacePackage, packagePath) {
  const relativePath = relative(WORKSPACE_ROOT, packagePath)
  return workspacePackage.name === 'account'
    || relativePath === 'account'
    || relativePath.startsWith(`account${sep}`)
}

function packageLabel(workspacePackage, packageJson, packagePath) {
  const relativePath = relative(WORKSPACE_ROOT, packagePath)
  if (relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)) {
    return relativePath
  }
  return workspacePackage.name || packageJson.name || packagePath
}

function countTestFiles(packagePath, nestedPackagePaths) {
  let count = 0
  const pendingDirectories = [packagePath]

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop()
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const directoryPath = resolve(currentDirectory, entry.name)
        if (!IGNORED_DIRECTORIES.has(entry.name) && !nestedPackagePaths.has(directoryPath)) {
          pendingDirectories.push(directoryPath)
        }
        continue
      }

      if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
        count += 1
      }
    }
  }

  return count
}

function isNestedPackagePath(parentPath, candidatePath) {
  const relativePath = relative(parentPath, candidatePath)
  return relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath)
}

function selectPackages(options) {
  if (options.packageDirs.length > 0) {
    return options.packageDirs.map(packagePath => ({ path: packagePath }))
  }

  return loadWorkspacePackages(options.workspaceListFile)
    .filter(workspacePackage => {
      if (typeof workspacePackage.path !== 'string' || workspacePackage.path.length === 0) {
        throw new Error('pnpm workspace entry is missing its path')
      }

      const packagePath = resolve(WORKSPACE_ROOT, workspacePackage.path)
      return packagePath !== WORKSPACE_ROOT && !isAccountWorkspace(workspacePackage, packagePath)
    })
}

function loadPackageMetadata(workspacePackage) {
  if (typeof workspacePackage.path !== 'string' || workspacePackage.path.length === 0) {
    throw new Error('package entry is missing its path')
  }

  const packagePath = resolve(WORKSPACE_ROOT, workspacePackage.path)
  const packageJsonPath = resolve(packagePath, 'package.json')
  if (!existsSync(packageJsonPath)) {
    throw new Error(`${workspacePackage.name || packagePath} is missing package.json`)
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  return {
    label: packageLabel(workspacePackage, packageJson, packagePath),
    packagePath,
    packageJson
  }
}

function validatePackages(packageEntries) {
  const uniquePackageEntries = [...new Map(packageEntries.map(entry => [resolve(WORKSPACE_ROOT, entry.path), entry])).values()]
  const packages = uniquePackageEntries
    .map(loadPackageMetadata)
    .sort((left, right) => left.label.localeCompare(right.label))

  return packages.map(packageMetadata => {
    const nestedPackagePaths = new Set(packages
      .filter(candidate => isNestedPackagePath(packageMetadata.packagePath, candidate.packagePath))
      .map(candidate => candidate.packagePath))

    return {
      label: packageMetadata.label,
      testFileCount: countTestFiles(packageMetadata.packagePath, nestedPackagePaths),
      hasTestScript: typeof packageMetadata.packageJson.scripts?.test === 'string'
        && packageMetadata.packageJson.scripts.test.trim().length > 0
    }
  })
}

function reportResults(results) {
  const reportLines = ['[test-scripts] package test files:']
  for (const result of results) {
    reportLines.push(`  - ${result.label}: ${result.testFileCount} (scripts.test: ${result.hasTestScript ? 'yes' : 'no'})`)
  }

  const totalTestFiles = results.reduce((total, result) => total + result.testFileCount, 0)
  reportLines.push(`[test-scripts] total: ${totalTestFiles} test file${totalTestFiles === 1 ? '' : 's'} across ${results.length} package${results.length === 1 ? '' : 's'}`)

  const failures = results.flatMap(result => {
    if (result.testFileCount > 0 && !result.hasTestScript) {
      return [`${result.label}: ${result.testFileCount} test file${result.testFileCount === 1 ? '' : 's'} but scripts.test is missing`]
    }
    if (result.testFileCount === 0 && result.hasTestScript) {
      return [`${result.label}: scripts.test exists but no test files were found`]
    }
    return []
  })

  if (failures.length > 0) {
    reportLines.push('[test-scripts] failed:')
    for (const failure of failures) {
      reportLines.push(`  - ${failure}`)
    }
    console.error(reportLines.join('\n'))
    process.exitCode = 1
    return
  }

  reportLines.push('[test-scripts] passed')
  console.info(reportLines.join('\n'))
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  reportResults(validatePackages(selectPackages(options)))
}

try {
  main()
} catch (error) {
  console.error(`[test-scripts] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
