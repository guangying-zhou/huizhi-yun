declare module 'pptx-preview' {
  export interface PreviewerOptionsType {
    renderer?: string
    width?: number
    height?: number
    mode?: 'list' | 'slide'
  }

  export interface PPTXPreviewer {
    preview(file: ArrayBuffer): Promise<unknown>
    load(file: ArrayBuffer): Promise<unknown>
    renderSingleSlide(slideIndex: number): void
    destroy(): void
  }

  export function init(dom: HTMLElement, options: PreviewerOptionsType): PPTXPreviewer
}
