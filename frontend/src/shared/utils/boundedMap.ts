/**
 * 容量受限的 Map（按插入序淘汰最旧项）。
 * 项目内 loadStatic / forecastStore.requestCache / floodAdapter 档位缓存原先各自
 * 手写「size 超限删最旧键」，收敛到此处一份实现；行为与 Map 完全兼容
 * （可作为 shallowRef 值、可序列化 Array.from(entries())、支持常规迭代）。
 * 淘汰策略：set 时若已满且键不存在，删除 Map 迭代序首键（插入序最久）。
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) {
    super()
    if (!Number.isFinite(maxSize) || maxSize <= 0) {
      throw new RangeError('BoundedMap maxSize 必须为正数')
    }
  }

  override set(key: K, value: V): this {
    if (this.size >= this.maxSize && !this.has(key)) {
      const oldestKey = this.keys().next().value
      if (oldestKey !== undefined) this.delete(oldestKey)
    }
    return super.set(key, value)
  }
}
