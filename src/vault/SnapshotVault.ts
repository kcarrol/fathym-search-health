/**
 * SnapshotVault: one git-backed fai vault holding every run's result, so "what changed since last time"
 * compares the newest two. Built the way dev-space's analytics workbench builds its AppInsightsVault: each
 * capture is preserved as `snapshots/{YYYYMMDDTHHMMSSmmm}-{Kind}.json`, and readers read those files.
 */
import { z } from "zod";
import { join } from "@std/path";
import { GitStorageStrategy, Vault } from "@fathym/fai/vaults";

export const KINDS = ["site", "keywords", "searchconsole", "opportunities"] as const;
export type Kind = typeof KINDS[number];

export const SnapshotSchema = z.object({
  Timestamp: z.number(),
  Kind: z.enum(KINDS),
  Results: z.record(z.string(), z.unknown()),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** `20261120T140501123` for a millisecond timestamp, in UTC. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(".", "").replace("Z", "");
}

export function SnapshotVault() {
  return Vault("search-health-snapshots", "Every search-health run's result, by kind and time")
    .Input(z.object({ Path: z.string() }))
    .Keeps(SnapshotSchema)
    .Storage(GitStorageStrategy((ctx) => ctx.Input.Path))
    // deno-lint-ignore require-await
    .Preserves(async (ctx) => {
      const files: Record<string, string> = {};
      for (const entry of Object.values(ctx.Keeps)) {
        files[`snapshots/${stamp(entry.Timestamp)}-${entry.Kind}.json`] = JSON.stringify(entry, null, 2);
      }
      return files;
    })
    .Accepts(() => ({ Accept: true as const }));
}

/** The newest `limit` snapshots of a kind, newest first. Empty when there are none yet. */
export async function readHistory(path: string, kind: Kind, limit = 10): Promise<Snapshot[]> {
  const dir = join(path, "snapshots");
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) if (e.isFile && e.name.endsWith(`-${kind}.json`)) names.push(e.name);
  } catch {
    return [];
  }
  names.sort().reverse();
  const out: Snapshot[] = [];
  for (const name of names.slice(0, limit)) {
    out.push(SnapshotSchema.parse(JSON.parse(await Deno.readTextFile(join(dir, name)))));
  }
  return out;
}
