import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { readConfig } from "../config.js";
import { verifyRoot } from "../diagnostics/demo-campaign.js";
import { portReleaseProbe } from "../diagnostics/port-probe.js";
import type { SessionPreparation } from "./session-manager.js";

/** Private, operator-reviewed file. No profile fields are HTTP inputs. */
export interface LocalSessionProfile {
  id: string;
  root: string;
  java: string;
  jar: string;
  eulaFile: string;
  serverPort: number;
  dashboardPort: number;
  username: string;
  observerUsername: string;
  operatorReadyAt: string;
}
const javaHash =
  "61d68093370e1f2890ecbaff865279f5580809f92be921a7ca33ed603db4d091";
const jarHash =
  "98ab064389a8b34d48ac3d4c5ed858dd9433d0dfd1a12e1cbbda916448d92994";
export function validateLocalProfile(value: unknown): LocalSessionProfile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid_session_profile");
  const p = value as LocalSessionProfile;
  const keys = Object.keys(p).sort().join(",");
  if (
    keys !==
      "dashboardPort,eulaFile,id,jar,java,observerUsername,operatorReadyAt,root,serverPort,username" ||
    typeof p.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(p.id) ||
    p.id === "7e6048dd-945a-4568-8e01-e3b43d028257" ||
    ![p.root, p.java, p.jar, p.eulaFile].every(
      (v) => typeof v === "string" && isAbsolute(v),
    ) ||
    basename(p.root) !== p.id ||
    ![p.username, p.observerUsername].every(
      (v) => typeof v === "string" && /^[A-Za-z0-9_]{3,16}$/.test(v),
    ) ||
    p.username.toLowerCase() === p.observerUsername.toLowerCase() ||
    ![p.serverPort, p.dashboardPort].every(
      (v) => Number.isInteger(v) && v >= 1024 && v <= 65535,
    ) ||
    p.serverPort === p.dashboardPort ||
    typeof p.operatorReadyAt !== "string" ||
    !Number.isFinite(Date.parse(p.operatorReadyAt))
  )
    throw Error("invalid_session_profile");
  return structuredClone(p);
}
function offlineIdentity(name: string) {
  const bytes = createHash("md5")
    .update("OfflinePlayer:" + name)
    .digest();
  bytes[6] = (bytes[6]! & 15) | 48;
  bytes[8] = (bytes[8]! & 63) | 128;
  const h = bytes.toString("hex");
  return {
    name,
    uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
  };
}
/** No IO or process launch until an explicit Start request consumes the ledger. */
export function prepareLocalSession(value: unknown): SessionPreparation {
  const p = validateLocalProfile(value);
  return {
    id: p.id,
    root: p.root,
    validateRoot: () => verifyRoot(p.root),
    config: readConfig({
      MC_HOST: "127.0.0.1",
      MC_PORT: String(p.serverPort),
      MC_USERNAME: p.username,
      MC_VERSION: "26.1",
      CONNECT_TIMEOUT_MS: "15000",
      SHUTDOWN_TIMEOUT_MS: "3000",
    }),
    portReleased: portReleaseProbe(p.serverPort),
    launch: () => {
      verifyRoot(p.root);
      const age = Date.now() - Date.parse(p.operatorReadyAt);
      if (age < 0 || age > 15 * 60000)
        throw Error("fresh_operator_readiness_required");
      if (
        createHash("sha256").update(readFileSync(p.java)).digest("hex") !==
          javaHash ||
        createHash("sha256").update(readFileSync(p.jar)).digest("hex") !==
          jarHash
      )
        throw Error("pinned_runtime_mismatch");
      if (!/^eula=true\s*$/m.test(readFileSync(p.eulaFile, "utf8")))
        throw Error("existing_eula_acceptance_required");
      const version = spawnSync(p.java, ["-version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      });
      if (version.status !== 0 || !/openjdk version "25/.test(version.stderr))
        throw Error("java25_required");
      const directory = join(p.root, "server");
      mkdirSync(directory);
      copyFileSync(p.jar, join(directory, "server.jar"));
      const properties = {
        "server-ip": "127.0.0.1",
        "server-port": p.serverPort,
        "online-mode": false,
        "enforce-secure-profile": false,
        gamemode: "survival",
        "force-gamemode": true,
        difficulty: "peaceful",
        hardcore: false,
        "level-name": "world",
        "level-seed": "",
        "level-type": "minecraft:flat",
        "generator-settings": JSON.stringify({
          biome: "minecraft:plains",
          layers: [
            { block: "minecraft:bedrock", height: 1 },
            { block: "minecraft:dirt", height: 2 },
            { block: "minecraft:grass_block", height: 1 },
          ],
          lakes: false,
          features: false,
        }),
        "generate-structures": false,
        "spawn-protection": 0,
        "enable-command-block": false,
        "enable-rcon": false,
        "enable-query": false,
        "op-permission-level": 0,
        "function-permission-level": 0,
        "max-players": 2,
        "view-distance": 4,
        "simulation-distance": 4,
        "pause-when-empty-seconds": 0,
        "white-list": true,
        "enforce-whitelist": true,
        motd: "MCBOT approved disposable session",
      };
      writeFileSync(
        join(directory, "server.properties"),
        Object.entries(properties)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n",
        { flag: "wx" },
      );
      writeFileSync(join(directory, "eula.txt"), "eula=true\n", { flag: "wx" });
      writeFileSync(join(directory, "ops.json"), "[]\n", { flag: "wx" });
      writeFileSync(
        join(directory, "whitelist.json"),
        JSON.stringify([
          offlineIdentity(p.username),
          offlineIdentity(p.observerUsername),
        ]),
        { flag: "wx" },
      );
      return spawn(
        p.java,
        ["-Xms512M", "-Xmx2G", "-jar", "server.jar", "nogui"],
        { cwd: directory, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
    },
  };
}
