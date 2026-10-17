import { defineConfig } from 'vitest/config'

// 根级配置：`npm run test:tools`（`vitest run --root . --dir tools`）用的就是它。
//
// 为什么必须显式排掉沙箱残留：`.local/` 与 `tmp-*/` 都在 .gitignore 里，但 vitest 的
// 默认 exclude 不含它们 ⇒ 变异沙箱留下的旧 worktree（实测 `.local/wt-z4`，detached
// HEAD 停在 09-23 的旧提交）会被当成正式测试再跑一遍，用**旧副本**参与判定。
// 判据的输入必须受版本控制（AGENTS §5.4「不得读 gitignored 路径」），否则同一份
// 测试在"有没有残留"两种状态下结论不同，绿与红都不再有意义。
//
// frontend/backend 各有自己的 vitest 配置，不受本文件影响。
//
// 为什么 testTimeout 抬到 30s（2026-10-17 用户裁决 4A）：默认 5s 在**全量并行**下不够。
// 定向实测两条 pytest 判据只要 1.2s / 1.4s（tools/flood/__tests__/*-python.test.mjs），
// 但全量跑时 20 核被 4 个 pytest 子进程与 AST 全仓扫描同时占满，实测涨到 6.2–6.4s
// ⇒ 概率性超时红。这与本文件的 exclude 无关：`.local/`、`tmp-*/` 早已排除，
// 超时来自 CPU 争抢，不是"扫描面太大"。
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.local/**', '.local/**', '**/tmp-*/**'],
    testTimeout: 30000,
  },
})
