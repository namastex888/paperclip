import fs from "node:fs";
import path from "node:path";
import { paperclipConfigSchema, type PaperclipConfig } from "@paperclipai/shared";
import { resolvePaperclipConfigPath } from "./paths.js";

export function readConfigFile(): PaperclipConfig | null {
  const configPath = resolvePaperclipConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return paperclipConfigSchema.parse(raw);
  } catch {
    return null;
  }
}

export function readRawConfigFile(): Record<string, unknown> | null {
  const configPath = resolvePaperclipConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function writeConfigFile(config: Record<string, unknown>): void {
  const configPath = resolvePaperclipConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, configPath + ".backup");
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
