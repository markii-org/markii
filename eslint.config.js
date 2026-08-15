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
    // smd-core is the framework-agnostic reference implementation (see
    // CLAUDE.md's "Import rule" and DESIGN.md §13): it must never import
    // React, react-dom, or smd-react. This is a lint-enforced version of
    // that rule, not just a convention.
    files: ['packages/smd-core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'smd-core must stay framework-agnostic — no React dependency (see CLAUDE.md import rule).',
            },
            {
              name: 'react-dom',
              message:
                'smd-core must stay framework-agnostic — no React dependency (see CLAUDE.md import rule).',
            },
            {
              name: 'smd-react',
              message:
                'smd-core must not depend on smd-react — smd-react depends on smd-core, never the reverse (see CLAUDE.md import rule).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'smd-react/*'],
              message:
                'smd-core must stay framework-agnostic and must not depend on smd-react (see CLAUDE.md import rule).',
            },
          ],
        },
      ],
    },
  },
  {
    // smd-bundle handles bundle storage and policy only (spec §9-11): it
    // must not import React (or anything React-flavored) and must not
    // depend on smd-react. See CLAUDE.md's smd-bundle scope note.
    files: ['packages/smd-bundle/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'smd-bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
            {
              name: 'react-dom',
              message:
                'smd-bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
            {
              name: 'smd-react',
              message:
                'smd-bundle must not depend on smd-react (see CLAUDE.md).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'smd-react/*'],
              message:
                'smd-bundle handles storage and policy only — no React dependency (see CLAUDE.md).',
            },
          ],
        },
      ],
    },
  },
);
