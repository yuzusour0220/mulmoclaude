// Minimal JSON file I/O for the token store. Unlike the host's
// `writeJsonAtomic` (and core's collection `atomic.ts`), this one supports a
// file mode — the token file must be 0600.
import { promises as fsp } from "node:fs";
import path from "node:path";

export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    const parsed: T = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

/** tmp-write + rename so readers never see a half-written file; `mode`
 *  applies to the tmp file and survives the rename. */
export async function writeJsonAtomicWithMode(filePath: string, data: unknown, mode: number): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode });
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
