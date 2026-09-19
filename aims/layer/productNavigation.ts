import { useAimsModule } from './useAimsModule'
import * as navigation from '../app/config/productNavigation'

export * from '../app/config/productNavigation'

export function productBasePath(code: string) {
  return useAimsModule().moduleUrl(navigation.productBasePath(code))
}
export function getProductPerspectives(code: string): navigation.ProductPerspective[] {
  const { moduleUrl } = useAimsModule()
  const item = (value: navigation.ProductNavItem) => ({ ...value, path: moduleUrl(value.path), extraPaths: value.extraPaths?.map(moduleUrl) })
  return navigation.getProductPerspectives(code).map(value => ({
    ...value, path: moduleUrl(value.path), extraPaths: value.extraPaths?.map(moduleUrl), items: value.items.map(item), more: value.more.map(item)
  }))
}
