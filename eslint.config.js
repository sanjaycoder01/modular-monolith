const modules = ['users', 'inventory', 'orders', 'payments', 'shipping'];

module.exports = [
  {
    files: ['src/**/*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023 },
  },

  // For each module, forbid requiring OTHER modules' internal/ folders
  ...modules.map((mod) => {
    const others = modules.filter((m) => m !== mod).join('|');
    return {
      files: [`src/modules/${mod}/**/*.js`],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: `CallExpression[callee.name='require'][arguments.0.value=/(^|\\/)(${others})\\/internal/]`,
            message:
              "Don't reach into another module's internal/. Use its index.js (public API).",
          },
        ],
      },
    };
  }),
];
