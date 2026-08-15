// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.vite/**',
    ],
  },
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Ambient `declare global { namespace JSX { ... } }` augmentation
      // (e.g. registering a custom element's props for JSX) has no ES2015
      // module alternative; only flag namespaces with actual runtime code.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // markii-core is the framework-agnostic reference implementation (see
    // CLAUDE.md's "Import rule" and DESIGN.md §13): it must never import
    // React, react-dom, or @markii/react. This is a lint-enforced version of
    // that rule, not just a convention.
    files: ['packages/markii-core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '@markii/core must stay framework-agnostic — no React dependency (see CLAUDE.md import rule).',
            },
            {
              name: 'react-dom',
              message:
                '@markii/core must stay framework-agnostic — no React dependency (see CLAUDE.md import rule).',
            },
            {
              name: '@markii/react',
              message:
                '@markii/core must not depend on @markii/react — @markii/react depends on @markii/core, never the reverse (see CLAUDE.md import rule).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', '@markii/react/*'],
              message:
                '@markii/core must stay framework-agnostic and must not depend on @markii/react (see CLAUDE.md import rule).',
            },
          ],
        },
      ],
    },
  },
  {
    // markii-bundle handles bundle storage and policy only (spec §9-11): it
    // must not import React (or anything React-flavored) and must not
    // depend on @markii/react. See CLAUDE.md's markii-bundle scope note.
    files: ['packages/markii-bundle/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '@markii/bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
            {
              name: 'react-dom',
              message:
                '@markii/bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
            {
              name: '@markii/react',
              message:
                '@markii/bundle must not depend on @markii/react (see CLAUDE.md).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', '@markii/react/*'],
              message:
                '@markii/bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // markii-runtime is the framework-agnostic value store (spec §8, Slice
    // 1's pure read path): it must not import React (or anything
    // React-flavored) and, for Slice 1, has no dependency on any other
    // @markii package — @markii/react depends on it, never the reverse.
    files: ['packages/markii-runtime/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '@markii/runtime is the framework-agnostic value store — no React dependency (see CLAUDE.md).',
            },
            {
              name: 'react-dom',
              message:
                '@markii/runtime is the framework-agnostic value store — no React dependency (see CLAUDE.md).',
            },
            {
              name: '@markii/react',
              message:
                '@markii/runtime must not depend on @markii/react — @markii/react depends on @markii/runtime, never the reverse.',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', '@markii/react/*'],
              message:
                '@markii/runtime is the framework-agnostic value store — no React dependency, and must not depend on @markii/react.',
            },
          ],
        },
      ],
    },
  },
  {
    // markii-lua is the sandboxed Lua execution primitive (spec §8, §10, §11):
    // it must not import React (or anything React-flavored) and must not
    // depend on @markii/core or @markii/react. It MAY depend on
    // @markii/bundle (for the `ScriptView` capability type) — that one is
    // deliberately not restricted here. See CLAUDE.md's markii-lua scope
    // note.
    files: ['packages/markii-lua/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                '@markii/lua is the sandboxed Lua execution primitive — no React dependency (see CLAUDE.md).',
            },
            {
              name: 'react-dom',
              message:
                '@markii/lua is the sandboxed Lua execution primitive — no React dependency (see CLAUDE.md).',
            },
            {
              name: '@markii/core',
              message:
                '@markii/lua must not depend on @markii/core (see CLAUDE.md).',
            },
            {
              name: '@markii/react',
              message:
                '@markii/lua must not depend on @markii/react (see CLAUDE.md).',
            },
          ],
          patterns: [
            {
              group: [
                'react/*',
                'react-dom/*',
                '@markii/core/*',
                '@markii/react/*',
              ],
              message:
                '@markii/lua is the sandboxed Lua execution primitive — no React/@markii/core/@markii/react dependency (see CLAUDE.md).',
            },
          ],
        },
      ],
    },
  },
);
