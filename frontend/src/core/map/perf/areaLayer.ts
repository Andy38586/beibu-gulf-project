/**
 * areaLayer —— 面/线图层工厂（z038①，A-4① 2D 拖图帧率）。
 *
 * 为什么单独成文件：`OLRenderer.ts` 体量棘轮已冻结（`tools/v3-guard/structure-check.mjs`，
 * z016 裁定 A-1「不拆分 ⇒ 新增内容另开文件」）。
 *
 * 取舍（OL 文档明示）：VectorImageLayer 把整层渲染成一张图片，拖图期只平移图片、不再逐要素
 * 重绘；代价是缩放动画期图片像素会被拉伸——故只用于**含面/线几何**的图层，纯点图层保持
 * VectorLayer（点符号会被旋转缩放）。命中测试两者同源（BaseVectorLayer.getFeatures）。
 */
import type Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import type BaseVectorLayer from 'ol/layer/BaseVector'
import VectorLayer from 'ol/layer/Vector'
import VectorImageLayer from 'ol/layer/VectorImage'
import type CanvasVectorImageLayerRenderer from 'ol/renderer/canvas/VectorImageLayer'
import type CanvasVectorLayerRenderer from 'ol/renderer/canvas/VectorLayer'
import type VectorSource from 'ol/source/Vector'

/** 面图层可用类型（两个类共有的基类面：getSource/setStyle/setZIndex；update 路径按本别名收口） */
export type AreaAwareVectorLayer = BaseVectorLayer<
  FeatureLike,
  VectorSource<FeatureLike>,
  CanvasVectorLayerRenderer | CanvasVectorImageLayerRenderer
>

/** 两个类共用同一份 BaseVectorLayer 选项面，取 VectorImageLayer 的声明为准 */
type AreaLayerOptions = NonNullable<ConstructorParameters<typeof VectorImageLayer>[0]>

/** 按几何类型选图层类：含面/线几何 → VectorImageLayer；纯点 → VectorLayer */
export function createVectorLayerByGeometry(
  features: Feature[],
  options: AreaLayerOptions
): AreaAwareVectorLayer {
  const hasAreaGeometry = features.some((f) => f.getGeometry()?.getType() !== 'Point')
  return hasAreaGeometry
    ? new VectorImageLayer(options)
    : new VectorLayer(options as ConstructorParameters<typeof VectorLayer>[0])
}
