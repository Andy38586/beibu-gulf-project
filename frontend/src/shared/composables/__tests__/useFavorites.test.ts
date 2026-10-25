// @vitest-environment jsdom
/**
 * useFavorites 全局收藏单例测试：
 * 登录守卫（未登录 add/remove 抛错）、幂等添加（existed 透传）、登录态驱动的拉取与清空、
 * 未登录收藏意图（pendingFavorite）在登录成功后自动补完。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { nextTick } from 'vue'

const mockApiRequest = vi.hoisted(() => vi.fn())
// user/token ref 在 mock 工厂内创建（vue ref），经 state 容器暴露给测试驱动登录态
const state = vi.hoisted(() => ({
  userRef: null as Ref<unknown> | null,
  tokenRef: null as Ref<unknown> | null,
}))

vi.mock('@/shared/composables/useApiRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useApiRequest')>()
  return {
    ...actual,
    useApiRequest: () => ({
      apiRequest: mockApiRequest,
      token: { value: '' } as never,
      isAuthenticated: { value: false } as never,
      setToken: vi.fn(),
      clearToken: vi.fn(),
    }),
  }
})

vi.mock('@/shared/composables/useAuth', async () => {
  const { ref } = await import('vue')
  const user = ref(null)
  const token = ref('')
  state.userRef = user
  state.tokenRef = token
  // token 补齐 UseAuthReturn 契约：useFavorites 的 watch 源为 [user, token]（L-3），
  // mock 缺 token 会触发「Invalid watch source: undefined」Vue warn
  // isAuthRestoreDone 同理：useFavorites catch 分支调用，缺失即 TypeError 炸弹
  return {
    useAuth: () => ({ user, token }),
    isAuthRestoreDone: () => true,
  }
})

async function importFreshFavorites() {
  vi.resetModules()
  return await import('../useFavorites')
}

/** 模拟登录成功（写入 user ref；类型仅为测试形状） */
function loginAs(user: unknown): void {
  state.userRef!.value = user
}

function logout(): void {
  if (state.userRef) {
    state.userRef.value = null
  }
}

const TEST_USER = { id: 'u1', username: 'tester', createdAt: '2026-08-29T00:00:00.000Z' }
const input = {
  itemType: 'xiaoqu' as const,
  itemId: 'B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
  snapshot: null,
}
const favoriteRecord = {
  id: 'f1',
  userId: 'u1',
  itemType: 'xiaoqu',
  itemId: 'B1',
  name: '小区A',
  lng: 1,
  lat: 2,
  savedAt: 't',
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 判据域 = frontend/src（两处收藏入口、唯一实现都在此） */
const SRC = path.resolve(HERE, '..', '..', '..')
const SKIP_DIR = /^(__tests__|__mocks__|node_modules|\.local|dist)$/
const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g

/** 两处收藏入口：未登录时必须走 promptLoginForFavorite，不得自写登录弹窗 */
const FAVORITE_ENTRY_FILES = [
  'core/map/components/MapFacilityBubble.vue',
  'shared/components/PaginatedListPanel.vue',
]
/**
 * 收藏登录引导文案的**唯一**合法持有者：useFavorites 里的 promptLoginForFavorite 实现。
 * 原先调试面板（core/layout/components/GCSDebugOverlay.vue）另有一份人工点验用的预览按钮，
 * 语义不同故刻意不复用；该面板已于 2026-10-26 随 GCS 调试层删除 ⇒ 持有者收敛为一处。
 */
const LOGIN_GUIDE_MESSAGE = '收藏功能需要登录，是否前往登录？'
const LOGIN_GUIDE_MESSAGE_OWNERS = ['shared/composables/useFavorites.ts']

interface SourceFile {
  rel: string
  text: string
}

/** 取 .vue 的 script 块（其余内容换成等量换行，保留行号；逻辑只在 script 区） */
function scriptOnly(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(SCRIPT_RE)) {
    const at = match.index ?? 0
    out += text.slice(last, at).replace(/[^\n]/g, '')
    out += match[1]
    last = at + match[0].length
  }
  return out + text.slice(last).replace(/[^\n]/g, '')
}

function readAllSources(): SourceFile[] {
  const files: SourceFile[] = []
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name)) walk(path.join(current, entry.name))
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      const abs = path.join(current, entry.name)
      const raw = fs.readFileSync(abs, 'utf8')
      files.push({
        rel: path.relative(SRC, abs).split(path.sep).join('/'),
        text: abs.endsWith('.vue') ? scriptOnly(raw) : raw,
      })
    }
  }
  walk(SRC)
  return files
}

/**
 * 找「自写登录弹窗」：showModal({ …, mode: 'login', … })。
 * 用 AST 不用文本子串：注释与字符串里的同款文案不该被判成命中。
 */
function scanLoginModals(file: SourceFile): Array<{ line: number }> {
  const sf = ts.createSourceFile(file.rel, file.text, ts.ScriptTarget.Latest, true)
  const hits: Array<{ line: number }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const first = node.arguments[0]
      if (node.expression.text === 'showModal' && first && ts.isObjectLiteralExpression(first)) {
        for (const prop of first.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'mode' &&
            ts.isStringLiteralLike(prop.initializer) &&
            prop.initializer.text === 'login'
          ) {
            hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** 阳性对照样本：第 3 行是手抄形态，扫描器必须咬到 */
function loginModalSample(): SourceFile {
  return {
    rel: 'probe.ts',
    text: [
      "import { showModal } from '@/shared'",
      'export function go(): void {',
      "  showModal({ message: '收藏功能需要登录，是否前往登录？', mode: 'login' })",
      '}',
    ].join('\n'),
  }
}

beforeEach(() => {
  // 默认 GET 返回空收藏（未覆盖时 watch 拉取也不至于拿到 undefined）；各用例按需覆盖
  mockApiRequest.mockClear()
  mockApiRequest.mockResolvedValue([])
  logout()
})

describe('useFavorites（全局收藏单例）', () => {
  it('在途拉取期间的登录态变化不丢失：置脏补拉（在途置脏重放）', async () => {
    // 放在 describe 首位以隔离旧模块实例噪声（模块级 watch 无 stop，旧实例
    // 也监听共享 ref，精确计数不可靠）——本用例必须是首个触达 apiRequest 的用例。
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    let heldUsed = false
    let releaseHeld!: (v: unknown) => void
    const held = new Promise((resolve) => {
      releaseHeld = resolve
    })
    mockApiRequest.mockImplementation(() => {
      if (!heldUsed) {
        heldUsed = true
        return held
      }
      return Promise.resolve([])
    })
    loginAs(TEST_USER)
    // 登录触发首轮拉取 → 挂起在途
    await vi.waitFor(() => expect(heldUsed).toBe(true))
    const callsAtHeld = mockApiRequest.mock.calls.length
    // 在途期间登录态变化（restore 以「保留临时登录态」收场置位 token）
    // → 旧实现 fetchInFlight 直接 return，本次事件被丢弃
    state.tokenRef!.value = 'restored-from-cache'
    await nextTick()
    // 放行在途 → finally 置脏重放：必须出现新的拉取调用（旧实现止步于首次）
    releaseHeld([])
    await vi.waitFor(() => expect(mockApiRequest.mock.calls.length).toBeGreaterThan(callsAtHeld))
    expect(favorites.favorites.value).toEqual([])
    // 复位登录态（模块级单例共享 ref，避免污染后续用例的「未登录」前提）
    logout()
    state.tokenRef!.value = ''
    await nextTick()
  })

  it('未登录 → add/remove 抛「请先登录」', async () => {
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await expect(favorites.addFavorite(input)).rejects.toThrow('请先登录')
    await expect(favorites.removeFavorite('xiaoqu', 'B1')).rejects.toThrow('请先登录')
    expect(mockApiRequest).not.toHaveBeenCalled()
  })

  it('登录后 addFavorite → 写入全局列表；isFavorite 按类型全局判定', async () => {
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    // 登录触发的拉取（GET /favorites）
    await vi.waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('/favorites', expect.anything())
    )
    mockApiRequest.mockResolvedValueOnce({ favorite: { ...favoriteRecord }, existed: false })
    const { existed } = await favorites.addFavorite(input)
    expect(existed).toBe(false)
    expect(favorites.isFavorite('xiaoqu', 'B1')).toBe(true)
    expect(favorites.isFavorite('facility', 'B1')).toBe(false)
  })

  it('addFavorite 幂等：服务端 existed=true → 本地不重复插入', async () => {
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith('/favorites', expect.anything())
    )
    mockApiRequest.mockResolvedValue({ favorite: { ...favoriteRecord }, existed: true })
    await favorites.addFavorite(input)
    await favorites.addFavorite(input)
    expect(favorites.favorites.value).toHaveLength(1)
  })

  it('removeFavorite → DELETE 调用并从列表移除', async () => {
    loginAs(TEST_USER)
    // mock 在 import（触发 watch 拉取）之前就位：GET 返回 1 条，DELETE 返回 removed
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') {
        return Promise.resolve({ removed: true })
      }
      return Promise.resolve([{ ...favoriteRecord }])
    })
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() => expect(favorites.favorites.value).toHaveLength(1))
    const removed = await favorites.removeFavorite('xiaoqu', 'B1')
    expect(removed).toBe(true)
    expect(favorites.favorites.value).toHaveLength(0)
  })

  it('未登录收藏意图 → 登录成功后自动补完（GET + POST）', async () => {
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    favorites.promptLoginForFavorite(input)
    // mock 在 loginAs 之前就位：GET 空，POST 返回收藏项
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          favorite: { id: 'f1', userId: 'u1', ...input, savedAt: 't' },
          existed: false,
        })
      }
      return Promise.resolve([])
    })
    loginAs(TEST_USER)
    await vi.waitFor(() =>
      expect(favorites.favorites.value.some((f) => f.itemId === 'B1')).toBe(true)
    )
  })

  it('登出 → 全局收藏清空', async () => {
    // mock 在 import 之前就位：GET 返回 1 条收藏
    mockApiRequest.mockImplementation(() => [{ ...favoriteRecord }])
    loginAs(TEST_USER)
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    await vi.waitFor(() => expect(favorites.favorites.value).toHaveLength(1))
    logout()
    await nextTick()
    expect(favorites.favorites.value).toHaveLength(0)
  })

  it('🔴 @guard-red-sample 收藏引导一步到位：落账意图 + 弹登录引导（登录后自动补交）', async () => {
    const { useFavorites } = await importFreshFavorites()
    // resetModules 之后取到的才是 useFavorites 实际用到的那个 gcsFeedback 实例
    const { gcsModalState, closeModal } = await import('@/shared/utils/gcsFeedback')
    const favorites = useFavorites()
    favorites.promptLoginForFavorite(input)

    // 第一步：登录引导弹窗，文案与模式固定；「去登录」走 GCSModal 的 login 默认分支
    expect(gcsModalState.visible).toBe(true)
    expect(gcsModalState.message).toBe('收藏功能需要登录，是否前往登录？')
    expect(gcsModalState.mode).toBe('login')
    expect(gcsModalState.confirmText).toBe('去登录')
    expect(gcsModalState.onConfirm).toBeNull()
    closeModal()

    // 第二步：意图已落账 ⇒ 登录成功后自动补交（拆成两个公开方法后调用方漏写第一步即在此变红）
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          favorite: { id: 'f1', userId: 'u1', ...input, savedAt: 't' },
          existed: false,
        })
      }
      return Promise.resolve([])
    })
    loginAs(TEST_USER)
    await vi.waitFor(() =>
      expect(favorites.favorites.value.some((f) => f.itemId === 'B1')).toBe(true)
    )
    const postBody = mockApiRequest.mock.calls.find(
      ([, options]) => (options as { method?: string } | undefined)?.method === 'POST'
    )?.[1] as { body?: unknown } | undefined
    // 补交的是用户刚才点收藏的那一项（不是别的意图）：apiRequest 的 body 是 JSON 串
    expect(JSON.parse(String(postBody?.body))).toMatchObject({ itemType: 'xiaoqu', itemId: 'B1' })
  })

  it('🔴 @guard-red-sample 收藏登录引导只经 promptLoginForFavorite 一个入口，两处收藏面板不得自抄 showModal', async () => {
    const sources = readAllSources()
    const offenders = sources
      .filter((file) => FAVORITE_ENTRY_FILES.includes(file.rel))
      .flatMap((file) => scanLoginModals(file).map((hit) => `${file.rel}:${hit.line} 手抄登录弹窗`))
    expect(offenders, '收藏面板必须调 promptLoginForFavorite，不得自写 showModal 登录引导').toEqual(
      []
    )
    // 阳性对照：换成手抄形态必须能被扫到（否则上一条断言是空转）
    expect(scanLoginModals(loginModalSample()).map((hit) => hit.line)).toContain(3)
    // 两处入口确实都在调唯一入口（删掉调用点即在此变红）
    for (const rel of FAVORITE_ENTRY_FILES) {
      const file = sources.find((item) => item.rel === rel)
      expect(file, `收藏入口文件不存在：${rel}`).toBeDefined()
      expect(file!.text, `${rel} 未调用 promptLoginForFavorite`).toContain(
        'promptLoginForFavorite('
      )
    }
    // 收藏引导文案只有一处：useFavorites（唯一实现，不接受第二份手抄副本）
    const messageOwners = sources
      .filter((file) => file.text.includes(LOGIN_GUIDE_MESSAGE))
      .map((file) => file.rel)
      .sort()
    expect(messageOwners).toEqual([...LOGIN_GUIDE_MESSAGE_OWNERS].sort())
  })

  it('🔴 登出清 pendingFavorite：换账号登录不补交上一账号的收藏意图（1004-06）', async () => {
    const { useFavorites } = await importFreshFavorites()
    const favorites = useFavorites()
    const postCalls = () =>
      mockApiRequest.mock.calls.filter(
        ([, options]) => (options as { method?: string } | undefined)?.method === 'POST'
      )
    // 未登录期排队一个收藏意图
    favorites.promptLoginForFavorite(input)
    // 账号 A 登录：补交失败 ⇒ 意图回滚保留（pendingFavorite = input）
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.reject(new Error('boom'))
      }
      return Promise.resolve([])
    })
    loginAs(TEST_USER)
    await vi.waitFor(() => expect(postCalls()).toHaveLength(1))
    await nextTick()

    // 登出：必须同时丢弃残留意图（修前不清 ⇒ 下一步换账号后被补交）
    logout()
    await nextTick()

    // 账号 B 登录
    mockApiRequest.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          favorite: { id: 'f2', userId: 'u2', ...input, savedAt: 't' },
          existed: false,
        })
      }
      return Promise.resolve([])
    })
    loginAs({ ...TEST_USER, id: 'u2', username: 'other' })
    // 等登录驱动的 GET 落账后再留一个稳定窗口：mutation 版（登出不清意图）会在
    // 此窗口内发出第二笔 POST；修复版停在 1 笔。sleep 60ms 远大于全部 mock 的微任务链。
    await vi.waitFor(() =>
      expect(
        mockApiRequest.mock.calls.filter(
          ([, options]) => (options as { method?: string } | undefined)?.method !== 'POST'
        ).length
      ).toBeGreaterThanOrEqual(2)
    )
    await new Promise((resolve) => setTimeout(resolve, 60))

    // 仍只有账号 A 那次失败的 POST，没有第二笔（跨账号补交）
    expect(postCalls()).toHaveLength(1)
    expect(favorites.favorites.value).toEqual([])
  })
})
