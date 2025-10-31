import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(new URL("../", import.meta.url)))
);

export function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(path.join(rootDir, specifier.slice(2))).href;
    return defaultResolve(target, context, defaultResolve);
  }

  return defaultResolve(specifier, context, defaultResolve);
}
