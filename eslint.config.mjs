// eslint-config-next 16 은 플랫 config 를 그대로 내보낸다. FlatCompat 로 감싸면
// 설정 객체에 순환 참조가 생겨 검증 단계에서 터지므로, 직접 펼쳐 쓴다.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...coreWebVitals,
  ...typescript
];

export default eslintConfig;
