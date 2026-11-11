declare module "*?raw" {
  const text: string;
  export default text;
}

// Vite's import.meta.glob, which the gateway's tsconfig (no vite/client types) does not declare.
interface ImportMeta {
  glob(
    pattern: string | string[],
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}
