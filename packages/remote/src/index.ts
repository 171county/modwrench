#!/usr/bin/env node
import { startRemoteServer } from "./server.js";

function parsePort(value: string | undefined): number {
  if (!value) return 3000;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

await startRemoteServer({
  host: process.env.MODWRENCH_REMOTE_HOST ?? "127.0.0.1",
  port: parsePort(process.env.MODWRENCH_REMOTE_PORT ?? process.env.PORT),
  allowedHosts: parseList(process.env.MODWRENCH_ALLOWED_HOSTS),
  allowedOrigins: parseList(process.env.MODWRENCH_ALLOWED_ORIGINS),
});
