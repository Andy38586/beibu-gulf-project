/**
 * 变异用例清单（mutation-probe/run.mjs 消费）。
 * 每条 = 一处【唯一锚点】的小破坏 + 应当抓住它的测试。新增关键纯模块时照此扩展。
 *
 * 字段：
 *   id      稳定编号；desc 人类可读；target 仓库相对目标文件；
 *   find    必须在目标中【唯一】出现的原文锚点；replace 变异后的破坏；
 *   test.cwd 运行目录（相对仓库根）；test.command 运行命令（首位 'npx' 会按平台替换 npx.cmd）。
 *
 * KNOWN_SURVIVORS：已知、暂不处理的存活变异编号（带理由写在注释）。默认应为空——
 * 这是「给后续发展留的容错位」，但每一项都必须显式登记，不允许悄悄存活。
 */
export const KNOWN_SURVIVORS = []

export const CASES = [
  // ───────── 防护外壳自身：被注入破坏时必须立刻变红（壳不能是纸糊的）─────────
  {
    id: 'M1',
    desc: '进程被信号杀死不得映射成成功(0)',
    target: 'scripts/lib/process-status.cjs',
    find: 'if (signal) return 1',
    replace: 'if (signal) return 0',
    test: {
      command: [
        'npx',
        'vitest',
        'run',
        '--root',
        '.',
        'tools/v3-guard/__tests__/process-status.test.mjs',
      ],
    },
  },
  {
    id: 'M2',
    desc: '跳过验证项时合入结论必须是 PARTIAL(2)，不得退回放行(0)',
    target: 'scripts/lib/merge-verdict.cjs',
    find: "code: 2, verdict: 'PARTIAL'",
    replace: "code: 0, verdict: 'PARTIAL'",
    test: { command: ['npx', 'vitest', 'run', '--root', '.', 'tools/merge-verdict.test.mjs'] },
  },
  {
    id: 'M3',
    desc: '承诺真库却沉睡跳过必须判 GATED_SKIP_IN_REQUIRED_ENV',
    target: 'scripts/test-watchdog.cjs',
    find: "code: 'GATED_SKIP_IN_REQUIRED_ENV',",
    replace: "code: 'MUTANT_SLEEP_PASS',",
    test: { command: ['npx', 'vitest', 'run', '--root', '.', 'tools/test-watchdog.test.mjs'] },
  },
  {
    id: 'M4',
    desc: '覆盖率回退必须被棘轮拦截（抬高触发门槛=放水）',
    target: 'scripts/coverage-ratchet.cjs',
    find: 'if (current[m] < floor) {',
    replace: 'if (current[m] < floor - 100) {',
    test: { command: ['npx', 'vitest', 'run', '--root', '.', 'tools/coverage-ratchet.test.mjs'] },
  },

  // ───────── 业务关键纯函数：契约级测试必须抓住数值被改坏（测试松不松，一突变便知）─────────
  {
    id: 'M5',
    desc: '距离衰减百分制被改成十分制（半程应 50 分）',
    target: 'backend/src/modules/site-analysis/services/scoring.ts',
    find: 'return (1 - distance / maxDistance) * 100',
    replace: 'return (1 - distance / maxDistance) * 10',
    test: { cwd: 'backend', command: ['npx', 'vitest', 'run', 'test/invariants-contract.spec.ts'] },
  },
  {
    id: 'M6',
    desc: '重要程度 5 档半径系数 2.2 被改（契约逐值锁定）',
    target: 'backend/src/common/constants/scoring.constants.ts',
    find: '  5: 2.2,',
    replace: '  5: 2.1,',
    test: { cwd: 'backend', command: ['npx', 'vitest', 'run', 'test/invariants-contract.spec.ts'] },
  },
  {
    id: 'M7',
    desc: '月度线性插值被改成恒取起点值（中间月应 105/110/115…）',
    target: 'backend/src/modules/forecast/services/model-loader.ts',
    find: 'value: Math.round(cur.value + (next.value - cur.value) * t),',
    replace: 'value: Math.round(cur.value),',
    test: { cwd: 'backend', command: ['npx', 'vitest', 'run', 'test/invariants-contract.spec.ts'] },
  },
  {
    id: 'M8',
    desc: '生产环境 PG_PASSWORD 强校验被拆除（回退静默默认口令）',
    target: 'backend/src/infra/db/db.config.ts',
    find: "const password = env.PG_PASSWORD ?? (isProduction ? undefined : 'postgres')",
    replace: "const password = env.PG_PASSWORD ?? 'postgres'",
    test: {
      cwd: 'backend',
      command: ['npx', 'vitest', 'run', 'test/config.service.spec.ts', 'test/db.config.spec.ts'],
    },
  },
]
