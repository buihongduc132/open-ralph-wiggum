/**
 * AGY (antigravity-cli) stdout-independent liveness probe.
 *
 * agy runs buffered (`--output-format json`, single line at exit) so ralph's
 * stdout-only watchdogs (heartbeat stall + pre-start) see silence for hours
 * on healthy runs. agy instead writes its own state:
 *
 *   ~/.gemini/antigravity-cli/conversations/<uuid>.db      SQLite (steps)
 *   ~/.gemini/antigravity-cli/conversations/<uuid>.db-wal  WAL sidecar (hot)
 *   ~/.gemini/antigravity-cli/presence/<uuid>.lock         held while running
 *
 * Association strategy (multiple unrelated agy processes may run on the
 * machine): snapshot presence/ before iteration start, diff after spawn —
 * the NEW lock is ours. Fallback: newest conversations/<uuid>.db(-wal) with
 * mtime >= startedAt. Activity = any db/wal mtime change since last poll, or
 * steps-table change (count / max idx / status set), or a step with
 * status=8 (running). Unknown while we cannot yet locate our conversation
 * (db creation can lag spawn) — fail-open.
 *
 * All reads are read-only; live WAL is included automatically by SQLite.
 */

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { LivenessProbe, LivenessProbeContext } from "./types";

// Resolved per call so tests (RALPH_AGY_HOME per temp dir) and env changes
// apply without module reload.
const agyRoot = (): string => process.env.RALPH_AGY_HOME ?? join(process.env.HOME ?? "", ".gemini", "antigravity-cli");

export interface AgyProbeState {
   /** presence/ snapshot taken before iteration start (basename set). */
   presenceBaseline: Set<string>;
   /** Resolved conversation uuid (from diff/fallback). */
   uuid: string | null;
   /** Last observed (db|wal) mtime, ms. */
   lastDbMtime: number;
   /** Last steps fingerprint `${count}:${maxIdx}:${running}` */
   lastStepsFingerprint: string | null;
   /** First successful poll timestamp. */
   lastPollAt: number;
}

const stepsFingerprint = (db: string): string | null => {
   // Read-only open of a live DB: SQLite replays WAL for readers.
   try {
      const database = new Database(db, { readonly: true });
      try {
         const rows = database.prepare(
            "SELECT COUNT(*) AS c, COALESCE(MAX(idx), -1) AS m, SUM(CASE WHEN status = 8 THEN 1 ELSE 0 END) AS r FROM steps",
         ).get() as { c: number; m: number; r: number | null } | undefined;
         if (!rows) return null;
         return `${rows.c}:${rows.m}:${rows.r ?? 0}`;
      } finally {
         database.close();
      }
   } catch {
      return null;
   }
};

const mtimeOf = (p: string): number => {
   try {
      return statSync(p).mtimeMs;
   } catch {
      return 0;
   }
};

const listPresenceLocks = (): string[] => {
   try {
      return readdirSync(join(agyRoot(), "presence"));
   } catch {
      return [];
   }
};

/**
 * Locate OUR conversation db given the pre-start presence baseline.
 * Prefers the new-lock diff (strictest association under concurrency);
 * falls back to the hottest conversation db created after iteration start.
 */
export function resolveAgyConversation(ctx: LivenessProbeContext, baseline: Set<string>): string | null {
   const convDir = join(agyRoot(), "conversations");
   // 1. new presence lock appeared since baseline → same uuid must have a db.
   //    Multiple fresh locks → tie-break by lock mtime nearest to startedAt
   //    (readdir order is arbitrary; never pick nondeterministically).
   const fresh = listPresenceLocks()
      .filter((f) => f.endsWith(".lock") && !baseline.has(f))
      .map((f) => ({ f, m: mtimeOf(join(agyRoot(), "presence", f)) }))
      .sort((a, b) => Math.abs(a.m - ctx.startedAt) - Math.abs(b.m - ctx.startedAt));
   for (const { f: lock } of fresh) {
      const uuid = lock.replace(/\.lock$/, "");
      if (existsSync(join(convDir, `${uuid}.db`))) return uuid;
   }
   // 2. fallback: hottest db modified after iteration start. Accept the
   //    single-candidate case; when several are hot, require a clear winner
   //    (gap > 3s) so concurrent unrelated agy runs aren't misattributed.
   try {
      const entries = readdirSync(convDir)
         .filter((f) => f.endsWith(".db"))
         .map((f) => ({ f, m: Math.max(mtimeOf(join(convDir, f)), mtimeOf(join(convDir, f + "-wal"))) }))
         .sort((a, b) => b.m - a.m);
      const top = entries[0];
      if (top && top.m >= ctx.startedAt - 5000) {
         const second = entries[1];
         if (!second || top.m - second.m > 3000) {
            return top.f.replace(/\.db$/, "");
         }
      }
   } catch {
      /* conversations dir missing → unknown */
   }
   return null;
}

/**
 * Build a per-iteration probe: call once per iteration BEFORE spawn and
 * invoke it once with {pid:0} so the presence baseline is snapshotted
 * PRE-SPAWN (ralph does this right after building cmdArgs). Subsequent
 * polls resolve our conversation via the baseline diff (new lock = ours).
 * Per-iteration state (baseline, resolved uuid, fingerprints) is closed
 * over; `active` verdicts feed ralph's StreamActivityTracker via markLine
 * so heartbeat + pre-start watchdogs stay honest for buffered agents.
 */
export function makeAgyLivenessProbe(): LivenessProbe {
   let state: AgyProbeState | null = null;
   const ensureState = (ctx: LivenessProbeContext): AgyProbeState => {
      if (!state) {
         state = {
            // Baseline is captured at FIRST invocation — which must be the
            // pre-spawn priming call (pid:0) from ralph, not a poll.
            presenceBaseline: new Set(listPresenceLocks()),
            uuid: null,
            lastDbMtime: 0,
            lastStepsFingerprint: null,
            lastPollAt: Date.now(),
         };
      }
      return state;
   };

   const probe: LivenessProbe = (ctx) => {
      const st = ensureState(ctx);
      if (!st.uuid) {
         st.uuid = resolveAgyConversation(ctx, st.presenceBaseline);
         if (!st.uuid) return { unknown: true, detail: "agy conversation db not located yet" };
      }
      const db = join(agyRoot(), "conversations", `${st.uuid}.db`);
      if (!existsSync(db)) return { unknown: true, detail: "db vanished" };
      const m = Math.max(mtimeOf(db), mtimeOf(db + "-wal"));
      let activity = false;
      // First observation must not claim spurious activity off a STALE hot
      // db (e.g. another concurrent session's): only a write that happened
      // after iteration start can count as OUR activity.
      const firstObservation = st.lastDbMtime === 0;
      if (m > st.lastDbMtime) {
         st.lastDbMtime = m;
         if (!firstObservation || m >= ctx.startedAt - 5000) activity = true;
      }
      const fp = stepsFingerprint(db);
      if (fp !== null) {
         if (fp !== st.lastStepsFingerprint) {
            st.lastStepsFingerprint = fp;
            activity = true;
         }
      }
      st.lastPollAt = Date.now();
      return activity
         ? { active: true, detail: `agy ${st.uuid.slice(0, 8)} steps=${st.lastStepsFingerprint ?? "?"}` }
         : { active: false, detail: `agy ${st.uuid.slice(0, 8)} quiet` };
   };

   return probe;
}
