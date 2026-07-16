// One-shot CLI (`yarn google:auth`): run the loopback + PKCE consent flow and
// store the refresh token locally. Same trigger model as `gcloud auth login`.
// This is an interactive terminal entry point, so it talks via console, not
// the server logger.
import { spawn } from "node:child_process";
import { errorMessage } from "../../utils/errors.js";
import { authorizeGoogle } from "./auth.js";
import { googleTokenPath } from "./paths.js";

// Same platform triple as the folder-reveal in server/api/routes/files.ts.
const openInBrowser = (url: string): void => {
  const [cmd, args] =
    process.platform === "darwin"
      ? (["open", [url]] as const)
      : process.platform === "win32"
        ? (["explorer.exe", [url]] as const)
        : (["xdg-open", [url]] as const);
  spawn(cmd, [...args], { stdio: "ignore", detached: true }).unref();
};

const main = async (): Promise<void> => {
  console.log("Opening the Google consent page in your browser…");
  await authorizeGoogle({
    onAuthUrl: (url) => {
      console.log(`If the browser does not open, visit:\n${url}\n`);
      openInBrowser(url);
    },
  });
  console.log(`✅ Google account linked. Tokens stored at ${googleTokenPath()} (mode 600).`);
};

main().catch((err: unknown) => {
  console.error(`❌ ${errorMessage(err)}`);
  process.exitCode = 1;
});
