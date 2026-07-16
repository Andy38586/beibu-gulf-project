import { MapRenderer } from './MapRenderer'
import { OLRenderer } from './OLRenderer'
import { CesiumRenderer } from './CesiumRenderer'

export { MapRenderer, OLRenderer, CesiumRenderer }

export function createRenderer(type, container) {
  const RendererClass = type === '2d' ? OLRenderer : CesiumRenderer
  return new RendererClass(container)
}