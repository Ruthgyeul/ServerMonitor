// eslint-config-next 16 exports a flat config directly. Wrapping it in FlatCompat
// creates a circular reference in the config object that blows up at the validation step, so spread it directly.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript
];

export default eslintConfig;
