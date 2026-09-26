export const PROJECT_LIST_QUERY_KEYS = ['category', 'status', 'portfolio', 'search', 'participatingOnly', 'view']

function first(value) { return Array.isArray(value) ? value[0] : value }

/** @returns {{ category: string, status: string, portfolio: string, search: string, participatingOnly: boolean, view: 'card' | 'list' }} */
export function readProjectListState(query = {}) {
  const participatingOnly = first(query.participatingOnly)
  return {
    category: String(first(query.category) || 'all'),
    status: String(first(query.status) || 'all'),
    portfolio: String(first(query.portfolio) || 'all'),
    search: String(first(query.search) || ''),
    participatingOnly: participatingOnly === undefined ? true : participatingOnly !== 'false',
    view: first(query.view) === 'list' ? 'list' : 'card'
  }
}

export function writeProjectListState(state) {
  const query = {}
  if (state.category !== 'all') query.category = state.category
  if (state.status !== 'all') query.status = state.status
  if (state.portfolio !== 'all') query.portfolio = state.portfolio
  if (state.search.trim()) query.search = state.search.trim()
  if (!state.participatingOnly) query.participatingOnly = 'false'
  if (state.view !== 'card') query.view = state.view
  return query
}
