# mutation-probe 变异测试（故障注入）自证器

覆盖率只证明代码**被执行过**，不证明断言**抓得住错误**。本目录用「变异测试」回答一个问题：
**如果把关键代码故意改坏，现有测试会不会变红？**

- `killed`＝改坏后测试变红，约束成立；
- `survived`＝改坏后测试仍绿，说明这条测试太松，需要补强或在 `cases.mjs` 的 `KNOWN_SURVIVORS` 显式登记理由。

## 用法

```bash
npm run test:mutation           # 跑全部变异用例（每条：注入→跑测试→必定还原）
node tools/mutation-probe/run.mjs --id M5        # 只跑某条
node tools/mutation-probe/run.mjs --json r.json  # 额外落 JSON 报告
```

## 安全保证

- 每个用例跑完**必定还原**目标文件（try/finally + 逐字节比对），中途异常也不留脏；
- 变异锚点 `find` 必须在目标文件中**唯一匹配**，匹配 0 次或多次都判 error，绝不误改。

## 怎么扩展（给后续关键模块加约束）

在 `cases.mjs` 的 `CASES` 里追加：选一处会改变对外行为的小破坏（改常数 / 反条件 / 删钳制），
`find` 填唯一原文、`replace` 填破坏后的代码、`test` 填应当抓住它的测试命令。
先确认它 `killed`；若 `survived`，先把对应测试补成契约级断言（参照
`backend/test/invariants-contract.spec.ts`：期望值有出处、断言能区分对错、先让它能失败）。

> 与 `scripts/test-watchdog.cjs` 的分工：看门狗治「静默跳过 / 用例没被执行 / 空壳」，
> 变异探针治「用例跑了但断言太松」。二者共同把「测试是松的、外壳直接放行」变成可执行的硬约束。
