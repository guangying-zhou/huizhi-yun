import { useAimsModule } from '../../layer/useAimsModule'
/**
 * useAimsDocumentPicker
 * 统一文档选择器的数据获取逻辑：
 *   - codocs_dept：项目所属部门下的目录 + 文档（/api/v1/codocs/department-documents）
 *   - codocs_portfolio：项目所属项目集 git_group 下的 Codocs 项目文档（/api/v1/codocs/project-documents）
 *   - repo：项目仓库下 docs/*.md（/api/account/projects/docs-tree/:code）
 *
 * 存储层面只区分 codocs / repo（两种 codocs 子源最终都产出 codocsUuid）
 */

export type DocumentSource = 'codocs' | 'repo'
/** UI 层面的子来源：区分部门/项目集两个 codocs 入口 */
export type DocumentSourceTab = 'codocs_dept' | 'codocs_portfolio' | 'repo'

export interface CodocsFolderItem {
  id: number
  name: string
  parentId: number | null
  updatedAt: string
}

export interface CodocsDocumentItem {
  uuid: string
  title: string
  ownerUid: string
  deptCode: string | null
  folderId: number | null
  folderName: string | null
  aiAbstract: string | null
  updatedAt: string
  contentSize: number
}

export interface RepoDocFile {
  path: string
  name: string
  blob_id?: string
}

export interface RepoTreeResult {
  files: RepoDocFile[]
  ref: string
  default_branch: string
  head_commit_id: string
  project_code: string
  repo_url: string
}

/**
 * 统一文档引用值
 *   codocs：{ source: 'codocs', codocsUuid, title }
 *   repo：  { source: 'repo', repoProjectCode, repoFilePath, repoCommitId?, title }
 */
export interface DocumentRef {
  source: DocumentSource
  title: string
  // codocs
  codocsUuid?: string | null
  // repo
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
}

function extractRequestErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback

  const requestError = error as {
    data?: { message?: unknown, statusMessage?: unknown }
    message?: unknown
    statusMessage?: unknown
  }
  const message = requestError.data?.message
    || requestError.data?.statusMessage
    || requestError.statusMessage
    || requestError.message

  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}

export function useAimsDocumentPicker() {
  // 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
  const { moduleUrl } = useAimsModule()
  // 部门文档
  const deptFolders = ref<CodocsFolderItem[]>([])
  const deptDocuments = ref<CodocsDocumentItem[]>([])
  const deptLoading = ref(false)

  // 项目集文档
  const portfolioFolders = ref<CodocsFolderItem[]>([])
  const portfolioDocuments = ref<CodocsDocumentItem[]>([])
  const portfolioLoading = ref(false)
  const portfolioGitGroup = ref<string | null>(null)

  // 仓库文档
  const repoTree = ref<RepoTreeResult | null>(null)
  const repoLoading = ref(false)
  const repoError = ref('')

  async function loadDeptDocs(deptCode: string | null | undefined) {
    if (!deptCode) {
      deptFolders.value = []
      deptDocuments.value = []
      return
    }
    deptLoading.value = true
    try {
      const res = await $fetch<{
        code: number
        data: { folders: CodocsFolderItem[], items: CodocsDocumentItem[] }
      }>(
        moduleUrl('/api/v1/codocs/department-documents'),
        { params: { deptCode } }
      )
      if (res.code === 0) {
        deptFolders.value = res.data.folders || []
        deptDocuments.value = res.data.items || []
      }
    } catch {
      deptFolders.value = []
      deptDocuments.value = []
    } finally {
      deptLoading.value = false
    }
  }

  async function loadPortfolioDocs(aimsProjectId: number | null | undefined) {
    if (!aimsProjectId) {
      portfolioFolders.value = []
      portfolioDocuments.value = []
      portfolioGitGroup.value = null
      return
    }
    portfolioLoading.value = true
    try {
      const res = await $fetch<{ code: number, data: { folders: CodocsFolderItem[], items: CodocsDocumentItem[], gitGroup: string | null } }>(
        moduleUrl('/api/v1/codocs/project-documents'),
        { params: { aimsProjectId } }
      )
      if (res.code === 0) {
        portfolioFolders.value = res.data.folders || []
        portfolioDocuments.value = res.data.items || []
        portfolioGitGroup.value = res.data.gitGroup || null
      }
    } catch {
      portfolioFolders.value = []
      portfolioDocuments.value = []
      portfolioGitGroup.value = null
    } finally {
      portfolioLoading.value = false
    }
  }

  async function loadRepoTree(repoProjectCode: string, aimsProjectId: number | null | undefined, ref?: string) {
    repoError.value = ''
    if (!repoProjectCode) {
      repoTree.value = null
      return
    }
    repoLoading.value = true
    try {
      const res = await $fetch<{ code: number, data: RepoTreeResult, message?: string }>(
        moduleUrl(`/api/account/projects/docs-tree/${encodeURIComponent(repoProjectCode)}`),
        { params: { ...(ref ? { ref } : {}), aimsProjectId: aimsProjectId || '' } }
      )
      if (res.code === 0) {
        repoTree.value = res.data
      } else {
        repoTree.value = null
        repoError.value = res.message || '加载仓库文档失败'
      }
    } catch (error) {
      repoTree.value = null
      repoError.value = extractRequestErrorMessage(error, '加载仓库文档失败')
    } finally {
      repoLoading.value = false
    }
  }

  return {
    deptFolders,
    deptDocuments,
    deptLoading,
    loadDeptDocs,
    portfolioFolders,
    portfolioDocuments,
    portfolioLoading,
    portfolioGitGroup,
    loadPortfolioDocs,
    repoTree,
    repoLoading,
    repoError,
    loadRepoTree
  }
}

export interface RepoDocResult {
  path: string
  name: string
  size: number
  content: string
  commit_id: string
  last_commit_id: string
  blob_id: string
  ref: string
}

export async function fetchRepoDocContent(
  repoProjectCode: string,
  filePath: string,
  options?: { ref?: string, commitId?: string | null, aimsProjectId?: number | null },
  // 本函数从事件处理器调用，那里不保证有 Nuxt 实例，所以不在内部调 useAimsModule；
  // 由调用方传入构造器，默认恒等 —— 独立应用行为不变。
  urlFor: (path: string) => string = path => path
): Promise<RepoDocResult | null> {
  try {
    const params: Record<string, string> = { path: filePath }
    if (options?.ref) params.ref = options.ref
    if (options?.commitId) params.commit_id = options.commitId
    if (options?.aimsProjectId) params.aimsProjectId = String(options.aimsProjectId)
    const res = await $fetch<{ code: number, data: RepoDocResult }>(
      urlFor(`/api/account/projects/doc/${encodeURIComponent(repoProjectCode)}`),
      { params }
    )
    if (res.code === 0) return res.data
    return null
  } catch {
    return null
  }
}
