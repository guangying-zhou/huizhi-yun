import { ref, type Ref } from 'vue'
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import type { Node as ProsemirrorNode } from '@milkdown/prose/model'
import type { EditorView } from '@milkdown/prose/view'

interface AnnotationLike {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  context_before?: string
  context_after?: string
  position_hint?: number
}

interface AnnotationSelectionState {
  from: number
  to: number
  text: string
}

interface CreateAnnotationPayload {
  selectedText: string
  contextBefore: string
  contextAfter: string
  positionHint: number
  content: string
}

interface UseEditorAnnotationsOptions {
  annotations: Ref<AnnotationLike[]>
  getEditorView: () => EditorView | null
  emitCreateAnnotation: (payload: CreateAnnotationPayload) => void
  emitClickAnnotation: (id: number) => void
  onPluginViewUpdate: (view: EditorView) => void
}

const annotationPluginKey = new PluginKey('annotation-tooltip')

const buildTextIndex = (doc: ProsemirrorNode) => {
  const segments: Array<{ start: number, end: number, pos: number, text: string }> = []
  let textOffset = 0

  doc.descendants((node: ProsemirrorNode, pos: number) => {
    if (!node.isText || !node.text) return true

    const text = node.text
    const start = textOffset
    const end = start + text.length

    segments.push({ start, end, pos, text })
    textOffset = end
    return true
  })

  return {
    fullText: segments.map(segment => segment.text).join(''),
    segments
  }
}

const textOffsetToPmPos = (segments: Array<{ start: number, end: number, pos: number }>, offset: number) => {
  if (!segments.length) return null

  const safeOffset = Math.max(0, offset)
  for (const segment of segments) {
    if (safeOffset >= segment.start && safeOffset <= segment.end) {
      return segment.pos + (safeOffset - segment.start)
    }
  }

  const last = segments[segments.length - 1]
  if (!last) return 0
  return last.pos + (last.end - last.start)
}

const findAllMatches = (source: string, target: string) => {
  if (!source || !target) return []

  const matches: number[] = []
  let fromIndex = 0
  while (fromIndex < source.length) {
    const index = source.indexOf(target, fromIndex)
    if (index === -1) break
    matches.push(index)
    fromIndex = index + 1
  }
  return matches
}

const scoreAnnotationCandidate = (fullText: string, ann: AnnotationLike, index: number) => {
  const selectedText = String(ann.selected_text || '')
  const before = String(ann.context_before || '')
  const after = String(ann.context_after || '')
  const hint = Number(ann.position_hint)

  let score = 0

  if (before) {
    const actualBefore = fullText.slice(Math.max(0, index - before.length), index)
    if (actualBefore === before) score += 120
    else if (actualBefore.endsWith(before.slice(-Math.min(10, before.length)))) score += 40
  }

  if (after) {
    const actualAfter = fullText.slice(index + selectedText.length, index + selectedText.length + after.length)
    if (actualAfter === after) score += 120
    else if (actualAfter.startsWith(after.slice(0, Math.min(10, after.length)))) score += 40
  }

  if (Number.isFinite(hint)) {
    score -= Math.abs(index - hint)
  }

  return score
}

export const useEditorAnnotations = ({
  annotations,
  getEditorView,
  emitCreateAnnotation,
  emitClickAnnotation,
  onPluginViewUpdate
}: UseEditorAnnotationsOptions) => {
  const isAnnotationDialogOpen = ref(false)
  const annotationSelection = ref<AnnotationSelectionState | null>(null)
  const marginIcons = ref<{ id: number, top: number }[]>([])
  const overlayStyle = ref<Record<string, string>>({})
  const activeAnnotationId = ref<number | null>(null)

  const getAnnotation = (id: number) => annotations.value.find(annotation => annotation.id === id) || null

  const findAnnotationPosition = (doc: ProsemirrorNode, ann: AnnotationLike) => {
    const selectedText = String(ann.selected_text || '')
    if (!selectedText) return null

    const { fullText, segments } = buildTextIndex(doc)
    if (!fullText || !segments.length) return null

    let matches = findAllMatches(fullText, selectedText)

    if (!matches.length && selectedText.length > 12) {
      const prefix = selectedText.slice(0, 12)
      matches = findAllMatches(fullText, prefix)
    }

    let bestIndex: number | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    for (const matchIndex of matches) {
      const score = scoreAnnotationCandidate(fullText, ann, matchIndex)
      if (score > bestScore) {
        bestScore = score
        bestIndex = matchIndex
      }
    }

    const fallbackHint = Number(ann.position_hint)
    if (bestIndex === null && Number.isFinite(fallbackHint)) {
      bestIndex = Math.max(0, Math.min(fullText.length - 1, fallbackHint))
    }

    if (bestIndex === null) return null

    const from = textOffsetToPmPos(segments, bestIndex)
    const to = textOffsetToPmPos(segments, bestIndex + Math.max(selectedText.length - 1, 0))

    if (from == null || to == null) return null

    return {
      from,
      to: Math.max(from, to)
    }
  }

  const annotationPlugin = new Plugin({
    key: annotationPluginKey,
    props: {
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement
        const annotationEl = target.closest('[data-annotation-id]')
        if (!annotationEl) return false

        const idStr = annotationEl.getAttribute('data-annotation-id')
        if (!idStr) return false

        const id = parseInt(idStr)
        emitClickAnnotation(id)
        return true
      }
    },
    view(editorView) {
      let resizeObserver: ResizeObserver | null = null
      let observing = false

      const connectObserver = () => {
        if (observing) return

        resizeObserver = new ResizeObserver(() => {
          updatePositions()
        })
        resizeObserver.observe(editorView.dom)

        const container = editorView.dom.closest('.crepe-wrapper')
        if (container) {
          resizeObserver.observe(container)
        }

        observing = true
      }

      const disconnectObserver = () => {
        resizeObserver?.disconnect()
        resizeObserver = null
        observing = false
      }

      const updatePositions = () => {
        if (!annotations.value.length) {
          disconnectObserver()
          marginIcons.value = []
          overlayStyle.value = {}
          return
        }

        connectObserver()

        const newIcons: { id: number, top: number }[] = []
        const editorRect = editorView.dom.getBoundingClientRect()
        const container = editorView.dom.closest('.crepe-wrapper')

        if (container) {
          const containerRect = container.getBoundingClientRect()
          if (window.innerWidth < 640) {
            overlayStyle.value = {
              right: '0.25rem',
              left: 'auto',
              width: '2rem'
            }
          } else {
            const contentRightRelative = editorRect.right - containerRect.left
            overlayStyle.value = {
              left: `${contentRightRelative - 60}px`,
              right: 'auto',
              width: '20px'
            }
          }
        }

        annotations.value.forEach((annotation) => {
          if (annotation.status === 'deleted') return

          const range = findAnnotationPosition(editorView.state.doc, annotation)
          if (!range) return

          try {
            const coords = editorView.coordsAtPos(range.from)
            const relativeTop = coords.top - editorRect.top
            const isNearby = newIcons.some(icon => Math.abs(icon.top - relativeTop) < 20)

            if (!isNearby) {
              newIcons.push({
                id: annotation.id,
                top: relativeTop
              })
            }
          } catch (error) {
            console.warn('Cannot find coords for annotation', error)
          }
        })

        marginIcons.value = newIcons
      }
      updatePositions()

      return {
        update(view) {
          updatePositions()
          onPluginViewUpdate(view)
        },
        destroy() {
          disconnectObserver()
        }
      }
    }
  })

  const openAnnotationDialog = () => {
    isAnnotationDialogOpen.value = true
    const view = getEditorView()
    if (!view) return

    const selection = view.state.selection
    if (!selection.empty && selection instanceof TextSelection) {
      annotationSelection.value = {
        from: selection.from,
        to: selection.to,
        text: view.state.doc.textBetween(selection.from, selection.to)
      }
      return
    }

    annotationSelection.value = null
  }

  const handleCreateAnnotation = (content: string) => {
    if (!annotationSelection.value) return
    const { text, from, to } = annotationSelection.value

    let contextBefore = ''
    let contextAfter = ''

    const view = getEditorView()
    if (view) {
      try {
        const doc = view.state.doc
        const safeFrom = Math.max(0, from - 20)
        const safeTo = Math.min(doc.content.size, to + 20)
        contextBefore = doc.textBetween(safeFrom, from)
        contextAfter = doc.textBetween(to, safeTo)
      } catch (error) {
        console.error('Error getting context', error)
      }
    }

    emitCreateAnnotation({
      selectedText: text,
      contextBefore,
      contextAfter,
      positionHint: from,
      content
    })
    isAnnotationDialogOpen.value = false
  }

  const toggleAnnotation = (id: number) => {
    if (activeAnnotationId.value === id) {
      activeAnnotationId.value = null
    } else {
      activeAnnotationId.value = id
    }
    emitClickAnnotation(id)
  }

  const scrollToAnnotation = (id: number) => {
    const annotation = annotations.value.find(item => item.id == id)
    if (!annotation) return

    const view = getEditorView()
    if (!view) return

    try {
      const range = findAnnotationPosition(view.state.doc, annotation)
      if (!range) return

      const tr = view.state.tr
      tr.setSelection(TextSelection.create(view.state.doc, range.from))
      tr.scrollIntoView()
      view.dispatch(tr)
    } catch (error) {
      console.error('Failed to scroll to annotation', error)
    }
  }

  return {
    annotationPlugin,
    isAnnotationDialogOpen,
    annotationSelection,
    marginIcons,
    overlayStyle,
    activeAnnotationId,
    getAnnotation,
    openAnnotationDialog,
    handleCreateAnnotation,
    toggleAnnotation,
    scrollToAnnotation
  }
}
