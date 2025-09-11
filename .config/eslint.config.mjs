import tseslint from "typescript-eslint"

export default tseslint.config(
  tseslint.configs.strictTypeCheckedOnly,
  tseslint.configs.stylisticTypeCheckedOnly,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      "**/.next/**",
      "private_notes/**",
      "**/.config/**",
      "apps/website/postcss.config.js",
      "apps/website/next.config.ts",
    ],
  },
  {
    rules: {
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
        },
      ],
    },
  },
)
