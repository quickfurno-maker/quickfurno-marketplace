import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_PRIVATE_KEY_BYTES = 16_384;
const MAX_KEY_PATH_CHARS = 512;

export function resolveJarvisSigningPrivateKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const inline = env.QF_JARVIS_SIGNING_PRIVATE_KEY_PEM?.replace(
    /\\n/g,
    "\n",
  ).trim();
  const file = env.QF_JARVIS_SIGNING_PRIVATE_KEY_FILE?.trim();

  if (inline && file) return null;
  if (inline) {
    return inline.length <= MAX_PRIVATE_KEY_BYTES ? inline : null;
  }
  if (!file) return null;
  if (
    !isAbsolute(file) ||
    file.length > MAX_KEY_PATH_CHARS ||
    file.includes("\0")
  ) {
    return null;
  }
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = readFileSync(file, "utf8").trim();
    if (value.length < 1 || value.length > MAX_PRIVATE_KEY_BYTES) return null;
    return value;
  } catch {
    return null;
  }
}
