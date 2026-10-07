import type { StoredWorld, World } from "@/lib/habitat/types";

export interface Snapshot { world: StoredWorld; revision: number; etag: string }
export interface HabitatStore {
  read(oidcToken?: string): Promise<Snapshot | null>;
  initialize(world: World, oidcToken?: string): Promise<Snapshot>;
  compareAndSwap(before: Snapshot, world: World, oidcToken?: string): Promise<Snapshot | null>;
}
