import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const FRAMEWORK_IMPORTS = [
  { group: ['next', 'next/*'], message: 'src/server and src/shared must stay framework-agnostic.' },
  { group: ['react', 'react-dom', 'react/*'], message: 'No UI imports outside the UI layers.' },
];

const SERVER_ONLY_FROM_UI = [
  {
    group: ['@/server/*', '@/server'],
    message: 'UI code talks to the backend through the REST API only.',
  },
  { group: ['server-only'], message: 'Server-only code must not be imported by UI code.' },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'infra/**',
    'drizzle/**',
    'next-env.d.ts',
  ]),

  {
    // Config vs code: process.env is read in exactly one module, the rest take typed config.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/core/config/**', 'src/instrumentation.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read configuration via getConfig() (src/server/core/config/env.ts), not process.env.',
        },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            {
              group: ['@/app/*', '@/components/*', '@/hooks/*', '@/lib/*'],
              message: 'The backend never imports UI code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            {
              group: ['@/server/*', '@/server'],
              message: 'Shared contracts are isomorphic: no server imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}', 'src/lib/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: SERVER_ONLY_FROM_UI }] },
  },
]);

export default eslintConfig;
