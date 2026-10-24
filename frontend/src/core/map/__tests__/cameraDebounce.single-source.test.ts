/**
 * 相机防抖时长单源守卫（W39）。
 *
 * 动因：`cameraPerf.ts`（3D）与 `OLRenderer.ts`（2D）各写一个裸 `}, 300)`
 * —— 同一「防抖后 emit camera-changed」形状被手抄两处。改时长只改一处会出现
 * 「3D 300ms / 2D 其他节奏」的相机回传差，且没有任何判据会红（AGENTS §七-7）。
 *
 * 判据不是源码文本子串（AGENTS §七-8）：用正则取两个引擎文件里 `setTimeout`
 * 的**第二参数字面量**，断言「要么是标识符 CAMERA_DEBOUNCE_MS，要么不存在」。
 * 阳性对照（手写 `}, 300)` 样本必红）与近失对照（注释里的 300 不许红）在件内。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const RENDERERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'renderers')
const PERF = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'perf')

function readRenderer(name: string): string {
  return readFileSync(`${RENDERERS}/${name}`, 'utf8')
}

/** 取 `setTimeout(..., <delay>)` 的第二参数 token（跳过回调体内的嵌套调用）。 */
function setTimeoutDelayTokens(src: string): string[] {
  const tokens: string[] = []
  // setTimeout( 之后到对应 ) , <delay>) 的第二参：只取第一层圆括号内、以 '}, ' 起手
  // 的常见形态；这里只服务于「裸字面量 300」这一具体违约，故用窄口径正则。
  const re = /\},\s*([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)\s*\)/g
  for (const m of src.matchAll(re)) tokens.push(m[1])
  return tokens
}

describe('相机防抖时长单源（CAMERA_DEBOUNCE_MS）', () => {
  it('两个引擎的 setTimeout 防抖参数都是标识符而非裸数字', () => {
    const files = ['CesiumRenderer.ts', 'OLRenderer.ts'].map(readRenderer)
    for (const [i, src] of files.entries()) {
      const tokens = setTimeoutDelayTokens(src)
      for (const t of tokens) {
        expect(Number.isNaN(Number(t)), `第 ${i + 1} 个引擎出现裸数字延迟 ${t}`).toBe(true)
      }
    }
  })

  it('阳性对照：裸 `}, 300)` 必红', () => {
    const tokens = setTimeoutDelayTokens('setTimeout(() => { emit() }, 300)')
    expect(tokens).toContain('300')
  })

  it('近失对照：注释里的 300 不算延迟参数', () => {
    const tokens = setTimeoutDelayTokens(
      '// 防抖 300ms\nsetTimeout(() => { emit() }, CAMERA_DEBOUNCE_MS)'
    )
    expect(tokens).toEqual(['CAMERA_DEBOUNCE_MS'])
  })

  it('常量只在 cameraTiming 定义，两个消费点都从它导入', () => {
    const timing = readFileSync(`${PERF}/cameraTiming.ts`, 'utf8')
    // 定义唯一 + 零 import（eager 链可安全消费）
    expect(timing).toMatch(/export const CAMERA_DEBOUNCE_MS = \d+/)
    expect(timing).not.toMatch(/^\s*import\s/m)
    // 两个消费点必须指向同一文件；本地再声明一份即红（原先只查「是不是标识符」）
    expect(readRenderer('OLRenderer.ts')).toMatch(/from '\.\.\/perf\/cameraTiming'/)
    expect(readFileSync(`${PERF}/cameraPerf.ts`, 'utf8')).toMatch(/from '\.\/cameraTiming'/)
  })
})
