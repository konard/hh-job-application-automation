// ESLint flat configuration (v9+)
export default [
  // CommonJS files (experiments/)
  {
    files: ['experiments/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Browser globals - used in page.evaluate() contexts and inbrowser-clicks.js
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: {
      // Possible Errors
      'no-console': 'off', // Console is used extensively for user communication
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(playwrightCode|puppeteerCode|form|hideBin)$' }],
      'no-undef': 'error',

      // Best Practices
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-with': 'error',

      // Style
      'indent': ['error', 2],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
    },
  },
  // ES modules files (.mjs and other .js files)
  {
    files: ['**/*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // Browser globals - used in page.evaluate() contexts
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: {
      // Possible Errors
      'no-console': 'off', // Console is used extensively for user communication
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(playwrightCode|puppeteerCode|form|hideBin)$' }],
      'no-undef': 'error',

      // Best Practices
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-with': 'error',

      // Style
      'indent': ['error', 2],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'package-lock.json',
      '.git/**',
    ],
  },
];
