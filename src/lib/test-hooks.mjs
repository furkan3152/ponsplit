// Loaded by `npm test` (node --import). Lets tests import server modules directly, the way the
// Next bundler resolves them: "server-only" is a no-op and extensionless relative imports find
// their .ts file, and JSON files import without an attribute.
import { register } from "node:module";

const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  // The published ESM entry imports Anchor's CommonJS BN as a named export,
  // which Node 22 cannot expose. Exercise the same SDK through its real CJS entry.
  if (specifier === "@pump-fun/agent-payments-sdk") {
    return next(specifier, {
      ...context,
      conditions: ["require", ...context.conditions.filter(condition => condition !== "import")],
    });
  }
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
}
export async function load(url, context, next) {
  // JSON settings files import without an attribute, as in the Next bundle.
  if (url.endsWith(".json")) return next(url, { ...context, importAttributes: { type: "json" } });
  return next(url, context);
}`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`);
