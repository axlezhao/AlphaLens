// Test-only module shims. These stand in for platform modules that only exist
// inside the Cloudflare/Next.js runtime so route handlers can run under plain
// Node. They never grant identity: `next/headers` yields an empty header set
// unless a test explicitly populates `globalThis.__TEST_NEXT_HEADERS__`.
const CLOUDFLARE_WORKERS_STUB =
  "data:text/javascript," +
  "export const env = new Proxy({}, { get: (_, key) => globalThis.__TEST_CLOUDFLARE_ENV__?.[key] });" +
  "export const waitUntil = (promise) => void promise;";

const NEXT_HEADERS_STUB =
  "data:text/javascript," +
  "export const headers = async () => globalThis.__TEST_NEXT_HEADERS__ ?? new Map();";

const NEXT_NAVIGATION_STUB =
  "data:text/javascript," +
  "export const redirect = (url) => { throw new Error(`unexpected redirect: ${url}`); };";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: CLOUDFLARE_WORKERS_STUB, shortCircuit: true };
  if (specifier === "next/headers") return { url: NEXT_HEADERS_STUB, shortCircuit: true };
  if (specifier === "next/navigation") return { url: NEXT_NAVIGATION_STUB, shortCircuit: true };
  // `next/font` and other UI-only Next APIs are not imported by the routes
  // under test; stub them so the module graph still resolves if they appear.
  if (specifier.startsWith("next/")) return { url: "data:text/javascript,export default class {};", shortCircuit: true };
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // `--experimental-strip-types` requires explicit extensions, while the
    // codebase imports extensionless paths resolved by the bundler. Retry with
    // the TypeScript extension appended.
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[tj]sx?$/.test(specifier)) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          // try the next candidate
        }
      }
    }
    throw error;
  }
}
