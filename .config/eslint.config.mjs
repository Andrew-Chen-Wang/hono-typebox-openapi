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
    ignores: ["private_notes/**", "**/.config/**"],
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
