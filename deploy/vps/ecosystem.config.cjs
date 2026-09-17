// pm2 process for the standalone Next.js server. Started by remote-deploy.sh
// from $APP_DIR/current (a symlink), so every reload picks up the new release.
const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util"); // Node >= 20.12
const path = require("node:path");

// Deploy location (VPS_DEPLOY_PATH secret), passed in by remote-deploy.sh.
const appDir = process.env.APP_DIR;
if (!appDir) throw new Error("APP_DIR is not set (the VPS_DEPLOY_PATH location)");
// Drop VERCEL / VERCEL_* (present in a `vercel env pull` file): off Vercel they
// would make the app and Next believe they are running on Vercel.
const env = Object.fromEntries(
  Object.entries(parseEnv(readFileSync(path.join(appDir, "shared/.env"), "utf8"))).filter(
    ([k]) => k !== "VERCEL" && !k.startsWith("VERCEL_"),
  ),
);

module.exports = {
  apps: [
    {
      name: "bch-rc",
      cwd: path.join(appDir, "current"),
      script: "server.js",
      // cluster mode + 1 instance: `pm2 reload` starts the new process before
      // stopping the old one, so a deploy does not drop requests.
      exec_mode: "cluster",
      instances: 1,
      max_memory_restart: "1G",
      env: {
        ...env,
        NODE_ENV: "production",
        PORT: process.env.APP_PORT || "3000",
        // Loopback only — nginx is the public entry point.
        HOSTNAME: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
};
