import { readFileSync } from "fs";

export interface BlacklistedAgent {
  agent: string;
  blacklistedAt: string;
  durationMs: number;
}

export interface LoopOwnershipState {
  active: boolean;
  pid?: number;
  pidStartSignature?: string;
}

export type LoopOwnershipDecision =
  | { status: "fresh" }
  | { status: "resume"; ownerPid?: number }
  | { status: "already-running"; ownerPid: number };

export class StreamActivityTracker {
  private readonly now: () => number;
  private activityAt: number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.activityAt = this.now();
  }

  markChunk(chunk: string): void {
    if (chunk.length > 0 && chunk.trim().length > 0) {
      this.activityAt = this.now();
    }
  }

  markLine(): void {
    this.activityAt = this.now();
  }

  get lastActivityAt(): number {
    return this.activityAt;
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function readProcessStartSignature(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8").trim();
      const statSuffixIndex = stat.lastIndexOf(") ");
      if (statSuffixIndex === -1) {
        return null;
      }
      const pidValue = stat.slice(0, stat.indexOf(" "));
      const statFields = stat.slice(statSuffixIndex + 2).trim().split(/\s+/);
      const startTimeTicks = statFields[19];
      if (!pidValue || !startTimeTicks) {
        return null;
      }
      return `${pidValue}:${startTimeTicks}`;
    } catch {
      return null;
    }
  }

  try {
    const proc = Bun.spawnSync(["ps", "-p", String(pid), "-o", "lstart="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      return null;
    }
    const signature = proc.stdout.toString().trim();
    return signature || null;
  } catch {
    return null;
  }
}

export function decideLoopOwnership(
  existingState: LoopOwnershipState | null,
  currentPid: number = process.pid,
): LoopOwnershipDecision {
  if (!existingState?.active) {
    return { status: "fresh" };
  }

  if (existingState.pid && existingState.pid !== currentPid && isProcessAlive(existingState.pid)) {
    const currentSignature = readProcessStartSignature(existingState.pid);
    if (!existingState.pidStartSignature || !currentSignature || currentSignature === existingState.pidStartSignature) {
      return { status: "already-running", ownerPid: existingState.pid };
    }
  }

  return { status: "resume", ownerPid: existingState.pid };
}

export function pruneExpiredBlacklistedAgents(
  entries: BlacklistedAgent[],
  nowMs: number,
): { active: BlacklistedAgent[]; expiredAgents: string[] } {
  const active: BlacklistedAgent[] = [];
  const expiredAgents: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const blacklistedTime = new Date(entry.blacklistedAt).getTime();
    const durationMs = Number(entry.durationMs);
    // Treat NaN dates/durations as expired; negative durations treated as active (invalid but just created)
    if (Number.isNaN(blacklistedTime) || Number.isNaN(durationMs)) {
      expiredAgents.push(entry.agent);
      continue;
    }
    if (durationMs <= 0) {
      // Negative/zero duration: keep as active (entry was just created with invalid duration)
      if (seen.has(entry.agent)) continue;
      seen.add(entry.agent);
      active.push(entry);
      continue;
    }
    const expiryTime = blacklistedTime + durationMs;
    if (nowMs >= expiryTime) {
      expiredAgents.push(entry.agent);
      continue;
    }
    if (seen.has(entry.agent)) continue;
    seen.add(entry.agent);
    active.push(entry);
  }

  return { active, expiredAgents };
}

export function selectRotationEntry(
  rotation: string[],
  rotationIndex: number,
  blacklistedAgents: BlacklistedAgent[],
): {
  entry: string;
  rotationIndex: number;
  skippedAgents: string[];
  clearedBlacklist: boolean;
} {
  if (rotation.length === 0) {
    return {
      entry: "",
      rotationIndex: 0,
      skippedAgents: [],
      clearedBlacklist: false,
    };
  }

  const normalizedIndex = ((rotationIndex % rotation.length) + rotation.length) % rotation.length;
  const blacklisted = new Set(blacklistedAgents.map((entry) => entry.agent));
  const skippedAgents: string[] = [];

  for (let attempts = 0; attempts < rotation.length; attempts++) {
    const currentIndex = (normalizedIndex + attempts) % rotation.length;
    const entry = rotation[currentIndex];
    if (!entry.includes(":")) continue;
    const [agent] = entry.split(":");
    if (!blacklisted.has(agent)) {
      return {
        entry,
        rotationIndex: currentIndex,
        skippedAgents,
        clearedBlacklist: false,
      };
    }
    skippedAgents.push(agent);
  }

  // Fallback: all entries blacklisted or invalid — validate fallback entry has colon
  const fallbackEntry = rotation[normalizedIndex];
  return {
    entry: fallbackEntry.includes(":") ? fallbackEntry : ":",
    rotationIndex: normalizedIndex,
    skippedAgents,
    clearedBlacklist: true,
  };
}
