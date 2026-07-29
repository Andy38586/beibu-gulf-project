import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from 'eslint-config-prettier/flat'
import tsParser from '@typescript-eslint/parser'
import vueParser from 'vue-eslint-parser'

export default defineConfig([
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,js,mjs,jsx,ts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**']),

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        // unplugin-auto-import 按需注入的 Element Plus API（脚本中直接使用，无显式 import）
        ElMessage: 'readonly',
        ElMessageBox: 'readonly',
        ElNotification: 'readonly',
        ElLoading: 'readonly',
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

  skipFormatting,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
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
