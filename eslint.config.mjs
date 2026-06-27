import antfu from '@antfu/eslint-config'

export default antfu(
  {
    gitignore: true,
    stylistic: true,
    typescript: true,
    formatters: {
      css: true,
      html: true,
      markdown: 'dprint',
    },
    yaml: true,
    react: true,
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      // Anchor-generated IDL types — copied verbatim from `target/types/`
      // by the SDK regen step. Linting them is pointless: they get
      // overwritten on every `anchor build`.
      'packages/sdk/src/types/**',
      'packages/sdk/src/idl/**',
      // Verbatim test artifacts: keypairs, .so binaries, dumped mainnet
      // accounts. Byte-exact fixtures, not code — style-linting is noise.
      'tests/fixtures/**',
    ],
  },
  {
    rules: {
      'antfu/consistent-list-newline': 'off',
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],

      'toml/padding-line-between-pairs': 'off',
      'toml/array-element-newline': 'off',
      'toml/array-bracket-spacing': ['error', 'never'],

      // 'ts/consistent-type-definitions': ['error', 'type'],
      'ts/consistent-type-definitions': 'off',
      'ts/consistent-type-imports': 'off',

      'curly': ['error', 'all'],

      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      'node/no-path-concat': 'off',

      'no-console': 'off',
    },
  },
)
