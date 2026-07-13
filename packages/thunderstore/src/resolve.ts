// Recursive Thunderstore dependency-tree resolver.
//
// thunderstore_mod_dependencies returns a package's DIRECT dependencies only.
// This walks the whole tree — deps of deps of deps — de-duplicated and
// cycle-safe, and returns an install-first order (a dependency always appears
// before anything that needs it). Pure: the fetch is injected, so it unit-tests
// without touching the network.

export type ResolvedNode = {
  /** "Namespace-Name" */
  fullName: string;
  namespace: string;
  name: string;
  version?: string;
  depth: number;
  /** full names of this package's direct dependencies */
  dependsOn: string[];
};

export type ResolveResult = {
  root: string;
  /** install-first order: dependencies before dependents; root is last */
  order: string[];
  nodes: ResolvedNode[];
  unresolved: Array<{ ref: string; reason: string }>;
  truncated: boolean;
  totalFetched: number;
};

export type FetchDeps = (
  namespace: string,
  name: string
) => Promise<{ version?: string; dependencies: string[] }>;

/**
 * Parse a Thunderstore dependency string "Namespace-Name-Version". Thunderstore
 * team and package names disallow hyphens, so the version is the last
 * hyphen-separated token and the namespace the first. Returns null only for a
 * genuinely malformed ref (no hyphen at all).
 */
export function parseDependencyString(
  dep: string
): { namespace: string; name: string; version?: string } | null {
  const parts = dep.split("-");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1] ?? "";
  const looksLikeVersion = /^\d+(\.\d+)*$/.test(last);
  if (looksLikeVersion && parts.length >= 3) {
    return {
      namespace: parts[0] ?? "",
      name: parts.slice(1, -1).join("-"),
      version: last,
    };
  }
  // No version segment — treat the whole thing as namespace-name.
  return { namespace: parts[0] ?? "", name: parts.slice(1).join("-") };
}

/**
 * Walk a package's full dependency tree. De-dupes shared deps, guards against
 * cycles, caps depth and total node count so a pathological graph can't run
 * away, and records anything it couldn't fetch or parse instead of throwing.
 */
export async function resolveDependencyTree(opts: {
  namespace: string;
  name: string;
  fetchDeps: FetchDeps;
  maxDepth?: number;
  maxNodes?: number;
}): Promise<ResolveResult> {
  const maxDepth = opts.maxDepth ?? 6;
  const maxNodes = opts.maxNodes ?? 200;
  const visited = new Map<string, ResolvedNode>();
  const order: string[] = [];
  const unresolved: Array<{ ref: string; reason: string }> = [];
  let truncated = false;
  let totalFetched = 0;

  async function walk(ns: string, nm: string, depth: number): Promise<void> {
    const fullName = `${ns}-${nm}`;
    const key = fullName.toLowerCase();
    if (visited.has(key)) return; // cycle / duplicate — guard BEFORE recursing
    if (visited.size >= maxNodes) {
      truncated = true;
      return;
    }
    const node: ResolvedNode = {
      fullName,
      namespace: ns,
      name: nm,
      depth,
      dependsOn: [],
    };
    visited.set(key, node);

    if (depth >= maxDepth) {
      truncated = true;
      order.push(fullName);
      return;
    }

    let deps: string[] = [];
    try {
      const res = await opts.fetchDeps(ns, nm);
      totalFetched++;
      if (res.version !== undefined) node.version = res.version;
      deps = res.dependencies ?? [];
    } catch (err) {
      unresolved.push({
        ref: fullName,
        reason: err instanceof Error ? err.message : String(err),
      });
      order.push(fullName);
      return;
    }

    for (const dep of deps) {
      const parsed = parseDependencyString(dep);
      if (!parsed) {
        unresolved.push({ ref: dep, reason: "unparseable dependency string" });
        continue;
      }
      node.dependsOn.push(`${parsed.namespace}-${parsed.name}`);
      await walk(parsed.namespace, parsed.name, depth + 1);
    }
    order.push(fullName); // post-order → install-first
  }

  await walk(opts.namespace, opts.name, 0);

  return {
    root: `${opts.namespace}-${opts.name}`,
    order,
    nodes: [...visited.values()],
    unresolved,
    truncated,
    totalFetched,
  };
}
