// The commit the app was built from, defined by vite.config.ts. Every file is a module here
// (moduleDetection: force), so the constant is declared as a global explicitly.
declare global {
  const __BUILD_COMMIT__: string
}
export {}
