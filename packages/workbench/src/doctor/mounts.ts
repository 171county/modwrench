import { readFileSync } from "node:fs";

// ─── Which kind of drive a folder is on ──────────────────────────────────────
// On Linux, /proc/mounts lists every mounted filesystem with its type. A Steam
// library on an NTFS or exFAT drive is a common Steam Deck and desktop-Linux
// setup (a drive shared with Windows, an SD card formatted elsewhere), and it is
// where Proton's prefixes are least happy. This reads that list; it runs nothing.

export type MountEntry = { device: string; mountPoint: string; type: string };

/** /proc/mounts writes a space, tab, newline or backslash inside a field as an octal escape. */
function unescapeField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

export function parseMounts(text: string): MountEntry[] {
  const out: MountEntry[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3) continue;
    out.push({ device: unescapeField(fields[0]!), mountPoint: unescapeField(fields[1]!), type: fields[2]!.toLowerCase() });
  }
  return out;
}

/** The mounts of this computer, or null where there is no /proc/mounts. */
export function readMounts(): MountEntry[] | null {
  try {
    return parseMounts(readFileSync("/proc/mounts", "utf8"));
  } catch {
    return null;
  }
}

/** The filesystem type of the mount that holds `path`: the one with the longest matching mount point. */
export function mountFor(mounts: readonly MountEntry[], path: string): MountEntry | null {
  let best: MountEntry | null = null;
  for (const m of mounts) {
    const point = m.mountPoint.length > 1 ? m.mountPoint.replace(/\/+$/, "") : m.mountPoint;
    const holds = point === "/" || path === point || path.startsWith(point + "/");
    if (holds && (best === null || point.length > best.mountPoint.length)) best = { ...m, mountPoint: point };
  }
  return best;
}

export type DriveKind =
  /** NTFS through the kernel driver. */
  | "ntfs"
  /** A FUSE block device: ntfs-3g shows up this way, and so do some exFAT drivers. */
  | "fuseblk"
  | "fat"
  | "other";

export function driveKind(type: string): DriveKind {
  const t = type.toLowerCase();
  if (t === "ntfs" || t === "ntfs3") return "ntfs";
  if (t === "fuseblk") return "fuseblk";
  if (t === "exfat" || t === "vfat" || t === "msdos" || t === "fat") return "fat";
  return "other";
}
