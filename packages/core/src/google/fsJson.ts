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

const IS_WINDOWS = process.platform === "win32";
const RENAME_RETRY_DELAYS_MS = [30, 100, 300];

const hasErrnoCode = (err: unknown): err is { code: string } =>
  typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string";

// On Windows, AV / Search Indexer / Defender briefly hold handles and rename
// trips EPERM/EBUSY/EACCES. The retry is gated to Windows because POSIX EPERM
// means a real permission problem — retrying would just delay the throw.
// Ported from the host's server/utils/files/atomic.ts.
const isTransientRenameError = (err: unknown): boolean =>
  IS_WINDOWS && hasErrnoCode(err) && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES");

async function renameWithWindowsRetry(fromPath: string, toPath: string): Promise<void> {
  for (const delayMs of RENAME_RETRY_DELAYS_MS) {
    try {
      await fsp.rename(fromPath, toPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  await fsp.rename(fromPath, toPath);
}

/** tmp-write + rename so readers never see a half-written file; `mode`
 *  applies to the tmp file and survives the rename. */
export async function writeJsonAtomicWithMode(filePath: string, data: unknown, mode: number): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode });
    await renameWithWindowsRetry(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
