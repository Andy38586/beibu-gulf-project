import { fileURLToPath } from 'node:url'

import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import { defineConfig, globalIgnores } from 'eslint/config'
import skipFormatting from 'eslint-config-prettier/flat'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default defineConfig([
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,js,mjs,jsx,ts,tsx}'],
  },

  // 任何以 dist 开头的构建产物目录都跳过（dist / dist-ssr / dist-tmp / dist_verify_* 等），
  // 避免把打包后的第三方库（Cesium/echarts/openlayers）和 chunk 误当源码 lint。
  // .workbuddy 为浏览器自动化临时 profile（gitignore 已有），不参与 lint。
  globalIgnores([
    '**/dist*/**',
    '**/coverage/**',
    '**/node_modules/**',
    '**/.venv/**',
    '**/.workbuddy/**',
  ]),

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        // unplugin-auto-import 按需注入的 Element Plus API（脚本中直接使用，无显式 import）
        ElMessage: 'readonly',
        ElMessageBox: 'readonly',
        ElNotification: 'readonly',
        ElLoading: 'readonly',
        // Cesium 库以全局变量形式注入（UMD / CDN / vite 外部化），非业务未定义变量
        Cesium: 'readonly',
        CESIUM_BASE_URL: 'readonly',
        CESIUM_WORKERS: 'readonly',
        CESIUM_VERSION: 'readonly',
      },
    },
  },

  {
    files: ['backend/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Node.js 最佳实践
      'no-process-exit': 'warn',
      'no-sync': 'off', // 启动脚本可以同步
      'no-path-concat': 'error',
    },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    // tools/、scripts/ 下的 .mjs Node 脚本（perf-bench 等基准/工具脚本）需要 node 全局
    files: ['tools/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  {
    // 根目录的构建/测试配置文件运行在 Node 环境（eslint.config.js 自身也在此列）
    files: ['eslint.config.js', 'frontend/vite.config.js', 'vitest.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  js.configs.recommended,
  // 新增：TypeScript recommended 规则集（关闭 no-explicit-any，阶段 10 清零后可改为 'error'）
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  // TypeScript 规则仅对 .ts/.tsx/.vue 有意义；对纯 .js 误报（no-unused-expressions 等）。
  // 在 .js 上关闭这几条 TS 规则（它们本就不该作用于无类型注解的 JS）。
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-array-constructor': 'off',
    },
  },

  skipFormatting,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // tsconfigRootDir 指向 frontend：tseslint 按 tsconfigRootDir 解析 include，
        // 否则 Windows 上 lint-staged 传入的绝对路径（git-bash 环境）与根相对 include 失配，
        // 报 "TSConfig does not include this file" 阻塞 pre-commit
        tsconfigRootDir: fileURLToPath(new URL('./frontend', import.meta.url)),
        project: './tsconfig.app.json',
        // 兜底：lint-staged 暂存文件在 Windows 以反斜杠路径传入时 glob 匹配可能失配，
        // 允许落入默认项目解析（完整 type-aware 检查仍由 CI 的 eslint . 保证）
        allowDefaultProject: ['src/**/*.ts', 'src/**/*.tsx'],
      },
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
        tsconfigRootDir: fileURLToPath(new URL('./frontend', import.meta.url)),
        project: './tsconfig.app.json',
        allowDefaultProject: ['src/**/*.vue'],
      },
    },
  },

  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // 覆盖 TS 规则：项目当前有显式 any，阶段 10 清零后可改为 'error'
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { caughtErrors: 'none', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      // import 顺序统一（分组 + 空行 + 字母序）
      // 注：原计划用 eslint-plugin-import 的 import/order，但其在 eslint 10 下
      // 调用已移除的 sourceCode.getTokenOrCommentAfter 会 TypeError 崩溃，故改用
      // 现代替代 simple-import-sort（eslint >=5 兼容，含 eslint 10）。语义等价。
      'simple-import-sort/imports': [
        'warn',
        {
          groups: [
            ['^node:'], // builtin（带 node: 前缀）
            [''], // external（npm 包）
            ['^@/'], // internal（@/ 别名）
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'], // parent（上级目录）
            ['^\\.[^.]', '^\\./?$'], // sibling / index（同级目录）
            ['^#'], // side-effect / type（type-only 等）
          ],
        },
      ],
      'simple-import-sort/exports': 'warn',
      // no-console：生产环境 error，其余 warn（DEV 守卫豁免由 NODE_ENV 控制）
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      // z069: prefer-const 强制未重新赋值的 let 改 const（纯机械替换，可 --fix）
      // 存量已清零（2026-08-03）。批次7 完工后已升 error。
      'prefer-const': 'error',
      // z070: vue/no-ref-as-operand 检测 ref 漏 .value（运行时 bug）。
      // 存量为 0（2026-08-03 摸底无违规），直接 error 阻断新增。
      'vue/no-ref-as-operand': 'error',
      // z056: no-floating-promises 见下方 typed-linting 专属块（仅 .ts/.vue）
    },
  },

  {
    // z056: no-floating-promises 需要 typed linting（parserOptions.project）。
    // 仅对 .ts/.vue 启用（已在上方对应块设置 project）；.js/.cjs 无类型信息不启用。
    // 存量 26 处已清零（2026-08-03），升 error 阻断新增。
    files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  {
    // .cjs 是 CommonJS 脚本，require() 是语法必需，不在 TS 体系
    files: ['**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  {
    // .d.ts 声明文件中的 `{}` 是合法的 ambient 类型写法，关闭空对象类型告警
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
])
