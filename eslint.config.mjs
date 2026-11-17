import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  { ignores: [".next/**", ".next-*/**", ".tmp/**", "backups/**", "node_modules/**", "storage/**", "coverage/**"] },
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
