import tseslint from 'typescript-eslint';
export default tseslint.config({ignores: ['**/node_modules/**','**/dist/**','**/.expo/**','**/android/**','**/ios/**']}, ...tseslint.configs.recommended, {files:['**/*.cjs'],rules:{'@typescript-eslint/no-require-imports':'off'}}, {
  rules: {'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error', {argsIgnorePattern:'^_', varsIgnorePattern:'^_'}]}
});
