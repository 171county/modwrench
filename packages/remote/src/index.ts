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

function parseAllowedHosts(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const hosts = value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return hosts.length > 0 ? hosts : undefined;
}

await startRemoteServer({
  host: process.env.MODWRENCH_REMOTE_HOST ?? "127.0.0.1",
  port: parsePort(process.env.MODWRENCH_REMOTE_PORT ?? process.env.PORT),
  allowedHosts: parseAllowedHosts(process.env.MODWRENCH_ALLOWED_HOSTS),
});
