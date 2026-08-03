/**
 * CesiumEvents — Cesium 3D 事件监听管理
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 负责 click / pointer-move / camera-changed 事件的注册与清理。
 * 事件状态存储在 renderer 实例上：
 * - renderer._screenSpaceEventHandler：屏幕事件处理器（click / mouse-move）
 * - renderer._cameraChangedHandler：相机变化监听器（防抖后 emit camera-changed）
 * - renderer._cameraDebounceTimer：相机变化防抖定时器
 */
import { Cartographic, Math as CesiumMath, ScreenSpaceEventType } from 'cesium'

/**
 * Cartesian3 转经纬度数组
 * @param cartesian Cesium.Cartesian3
 * @returns [lng, lat]（角度制）
 */
export function cartesianToLonLatArray(cartesian: any): [number, number] {
  const cartographic = Cartographic.fromCartesian(cartesian)
  return [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)]
}

/**
 * P1性能优化：相机变化防抖
 * 监听相机移动事件，300ms防抖后才触发渲染和状态同步。
 * 避免拖拽/缩放过程中频繁更新，降低CPU/GPU负载。
 * @param renderer CesiumRenderer 实例（访问 viewer / emit / _getCameraState）
 */
export function setupCameraDebounce(renderer: any): void {
  const DEBOUNCE_DELAY = 300
  // 保存监听器引用，供 destroy 移除，防止泄漏与 TypeError
  renderer._cameraChangedHandler = () => {
    // 清除之前的防抖定时器
    if (renderer._cameraDebounceTimer) {
      clearTimeout(renderer._cameraDebounceTimer)
    }
    renderer._cameraDebounceTimer = setTimeout(() => {
      // viewer 可能已置空，防御
      if (renderer.viewer) {
        renderer.viewer.scene.requestRender()
        // 相机变化防抖后回传状态（复用 _cameraChangedHandler，勿新增监听）
        renderer.emit('camera-changed', renderer._getCameraState())
      }
      renderer._cameraDebounceTimer = null
    }, DEBOUNCE_DELAY)
  }
  renderer.viewer.camera.changed.addEventListener(renderer._cameraChangedHandler)
}

/**
 * 设置点击与鼠标移动事件监听
 * - LEFT_CLICK：拾取要素 properties 并 emit click（含 featureType / data / coordinate）
 * - MOUSE_MOVE：a026 补齐 pointer-move 事件（emit 鼠标地面经纬度）
 * @param renderer CesiumRenderer 实例（访问 viewer / emit）
 */
export function setupClickHandler(renderer: any): void {
  renderer._screenSpaceEventHandler = renderer.viewer.screenSpaceEventHandler
  renderer._screenSpaceEventHandler.setInputAction((click: any) => {
    const pickedObject = renderer.viewer.scene.pick(click.position)
    const cartesian = renderer.viewer.camera.pickEllipsoid(click.position)
    const coordinate = cartesian ? cartesianToLonLatArray(cartesian) : null

    if (pickedObject && pickedObject.id && pickedObject.id.properties) {
      const properties = pickedObject.id.properties.getValue?.() || pickedObject.id.properties
      const featureType = properties.featureType
      if (featureType) {
        renderer.emit('click', {
          featureType,
          data: properties,
          coordinate,
        })
        return
      }
    }
    renderer.emit('click', {
      featureType: null,
      data: null,
      coordinate,
    })
  }, ScreenSpaceEventType.LEFT_CLICK)

  // pointer-move 事件（补齐 MapRendererEventMap 声明）
  renderer._screenSpaceEventHandler.setInputAction((movement: any) => {
    const cartesian = renderer.viewer.camera.pickEllipsoid(
      movement.endPosition,
      renderer.viewer.scene.globe.ellipsoid
    )
    if (cartesian) {
      const carto = Cartographic.fromCartesian(cartesian)
      renderer.emit('pointer-move', {
        lng: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
      })
    }
  }, ScreenSpaceEventType.MOUSE_MOVE)
}

/**
 * 清理事件监听（供 destroy 调用）
 * - 移除相机变化监听器
 * - 清理屏幕事件处理器（LEFT_CLICK / MOUSE_MOVE）
 * @param renderer CesiumRenderer 实例
 */
export function destroyEvents(renderer: any): void {
  // 移除相机监听器
  if (renderer.viewer && renderer._cameraChangedHandler) {
    renderer.viewer.camera.changed.removeEventListener(renderer._cameraChangedHandler)
    renderer._cameraChangedHandler = null
  }

  // 清理屏幕事件处理器，防止内存泄漏
  if (renderer._screenSpaceEventHandler) {
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
    renderer._screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.MOUSE_MOVE)
    renderer._screenSpaceEventHandler = null
  }
}
