import { describe, it, expect, vi } from 'vitest'
import { MapRenderer } from '../MapRenderer'

class MockRenderer extends MapRenderer {
  constructor(container) {
    super(container)
  }

  init() {}
  addPointLayer(_id, _features, _options) {}
  addPolygonLayer(_id, _features, _options) {}
  addGeoJsonLayer(_id, _geojson, _options) {}
  getType() {
    return 'mock'
  }
  _doSetVisibility(_id, _visible) {}
  _doRemoveLayer(_layer) {}
  _doFlyTo(_target, _options) {}
}

describe('MapRenderer Interface', () => {
  describe('Abstract Class Protection', () => {
    it('should throw error when instantiating MapRenderer directly', () => {
      expect(() => new MapRenderer('test-container')).toThrow('MapRenderer是抽象类，不能直接实例化')
    })

    it('should allow instantiating subclass', () => {
      expect(() => new MockRenderer('test-container')).not.toThrow()
    })
  })

  describe('Event System', () => {
    it('should emit and listen to events', () => {
      const renderer = new MockRenderer('test-container')
      const handler = vi.fn()

      renderer.on('click', handler)
      renderer.emit('click', { featureType: 'port', data: { name: 'test' } })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { featureType: 'port', data: { name: 'test' } },
        }),
      )
    })

    it('should remove event listener', () => {
      const renderer = new MockRenderer('test-container')
      const handler = vi.fn()

      renderer.on('click', handler)
      renderer.off('click', handler)
      renderer.emit('click', { featureType: 'port' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should support multiple event types', () => {
      const renderer = new MockRenderer('test-container')
      const clickHandler = vi.fn()
      const hoverHandler = vi.fn()

      renderer.on('click', clickHandler)
      renderer.on('hover', hoverHandler)

      renderer.emit('click', { type: 'click' })
      renderer.emit('hover', { type: 'hover' })

      expect(clickHandler).toHaveBeenCalledTimes(1)
      expect(hoverHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('State Management', () => {
    it('should export layer visibility state', () => {
      const renderer = new MockRenderer('test-container')
      renderer._layers.set('layer1', { instance: {}, visible: true })
      renderer._layers.set('layer2', { instance: {}, visible: false })

      const state = renderer.exportState()

      expect(state.layer1).toEqual({ visible: true })
      expect(state.layer2).toEqual({ visible: false })
    })

    it('should import layer visibility state', () => {
      const renderer = new MockRenderer('test-container')
      renderer._layers.set('layer1', { instance: {}, visible: true })
      renderer._layers.set('layer2', { instance: {}, visible: false })

      renderer.importState({
        layer1: { visible: false },
        layer2: { visible: true },
      })

      expect(renderer._layers.get('layer1').visible).toBe(false)
      expect(renderer._layers.get('layer2').visible).toBe(true)
    })

    it('should handle empty state', () => {
      const renderer = new MockRenderer('test-container')
      renderer.exportState()

      renderer.importState({})
      expect(renderer._layers.size).toBe(0)
    })
  })

  describe('Layer Management', () => {
    it('should set visibility on existing layer', () => {
      const renderer = new MockRenderer('test-container')
      renderer._layers.set('layer1', { instance: {}, visible: true })

      renderer.setVisibility('layer1', false)

      expect(renderer._layers.get('layer1').visible).toBe(false)
    })

    it('should queue pending visibility for non-existent layer', () => {
      const renderer = new MockRenderer('test-container')

      renderer.setVisibility('pending-layer', false)

      expect(renderer._pendingVisibility.has('pending-layer')).toBe(true)
      expect(renderer._pendingVisibility.get('pending-layer')).toBe(false)
    })

    it('should apply pending visibility after layer creation', () => {
      const renderer = new MockRenderer('test-container')
      renderer.setVisibility('layer1', false)

      renderer._layers.set('layer1', { instance: {}, visible: true })
      renderer._applyPendingVisibility('layer1')

      expect(renderer._layers.get('layer1').visible).toBe(false)
      expect(renderer._pendingVisibility.has('layer1')).toBe(false)
    })

    it('should not throw on non-existent layer', () => {
      const renderer = new MockRenderer('test-container')

      expect(() => renderer.setVisibility('non-existent', true)).not.toThrow()
    })

    it('should remove layer', () => {
      const renderer = new MockRenderer('test-container')
      renderer._layers.set('layer1', { instance: {}, visible: true })

      renderer.removeLayer('layer1')

      expect(renderer._layers.has('layer1')).toBe(false)
    })
  })

  describe('FlyTo Normalization', () => {
    it('should normalize coordinate array [lng, lat]', () => {
      const renderer = new MockRenderer('test-container')

      const normalized = renderer._normalizeFlyToTarget([120.5, 30.2])

      expect(normalized).toEqual({ lng: 120.5, lat: 30.2 })
    })

    it('should normalize coordinate object { lng, lat }', () => {
      const renderer = new MockRenderer('test-container')

      const normalized = renderer._normalizeFlyToTarget({ lng: 120.5, lat: 30.2 })

      expect(normalized).toEqual({ lng: 120.5, lat: 30.2 })
    })

    it('should normalize layerId string', () => {
      const renderer = new MockRenderer('test-container')

      const normalized = renderer._normalizeFlyToTarget('ports')

      expect(normalized).toEqual({ layerId: 'ports' })
    })

    it('should normalize layerId object', () => {
      const renderer = new MockRenderer('test-container')

      const normalized = renderer._normalizeFlyToTarget({ layerId: 'ports', featureId: 'port-001' })

      expect(normalized).toEqual({ layerId: 'ports', featureId: 'port-001' })
    })

    it('should return null for invalid target', () => {
      const renderer = new MockRenderer('test-container')

      const normalized = renderer._normalizeFlyToTarget({ invalid: 'data' })

      expect(normalized).toBeNull()
    })
  })

  describe('Destroy', () => {
    it('should clear layers and pending visibility', () => {
      const renderer = new MockRenderer('test-container')
      renderer._layers.set('layer1', { instance: {}, visible: true })
      renderer._pendingVisibility.set('layer2', true)

      renderer.destroy()

      expect(renderer._layers.size).toBe(0)
      expect(renderer._pendingVisibility.size).toBe(0)
    })
  })
})
