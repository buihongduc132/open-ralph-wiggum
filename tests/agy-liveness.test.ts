/**
 * Tests for AGY stdout-independent liveness probe (src/agy-liveness.ts).
 *
 * Uses a temp AGY_ROOT (RALPH_AGY_HOME) with:
 *   conversations/<uuid>.db (steps table) + .db-wal
 *   presence/<uuid>.lock
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { makeAgyLivenessProbe, resolveAgyConversation } from "../src/agy-liveness";

let root: string;
const UUID = "11111111-2222-3333-4444-555555555555";

const makeDb = (uuid: string, steps: Array<[number, number]>) => {
   const dir = join(root, "conversations");
   mkdirSync(dir, { recursive: true });
   const db = new Database(join(dir, `${uuid}.db`));
   db.exec("CREATE TABLE IF NOT EXISTS steps (idx integer PRIMARY KEY, status integer)");
   for (const [idx, status] of steps) db.query("INSERT INTO steps (idx, status) VALUES (?, ?)").run(idx, status);
   db.close();
};

beforeEach(() => {
   root = mkdtempSync(join(tmpdir(), "agy-liv-"));
   process.env.RALPH_AGY_HOME = root;
});

afterEach(() => {
   delete process.env.RALPH_AGY_HOME;
   rmSync(root, { recursive: true, force: true });
});

describe("resolveAgyConversation", () => {
   test("prefers new presence lock after baseline", () => {
      mkdirSync(join(root, "presence"), { recursive: true });
      writeFileSync(join(root, "presence", "old.lock"), "");
      const baseline = new Set(["old.lock"]);
      makeDb(UUID, [[0, 3]]);
      const ctx = { pid: 1, startedAt: Date.now() - 1000 };
      expect(resolveAgyConversation(ctx, baseline)).toBe(UUID);
   });

   test("no new lock + no fresh unambiguous db → null", () => {
      mkdirSync(join(root, "presence"), { recursive: true });
      const baseline = new Set<string>();
      const ctx = { pid: 1, startedAt: Date.now() + 100000 };
      expect(resolveAgyConversation(ctx, baseline)).toBeNull();
   });
});

describe("makeAgyLivenessProbe", () => {
   test("unknown before db exists, then active on first sight, quiet when nothing changes", () => {
      const probe = makeAgyLivenessProbe();
      const ctx = { pid: 1, startedAt: Date.now() - 1000 };
      probe({ pid: 0, startedAt: ctx.startedAt }); // pre-spawn priming call
      const first = probe(ctx);
      expect("unknown" in first && first.unknown).toBe(true);

      makeDb(UUID, [[0, 3], [1, 8]]);
      const second = probe(ctx);
      expect("active" in second && second.active).toBe(true);

      const third = probe(ctx);
      expect("active" in third && third.active).toBe(false);
   });

   test("first poll on STALE pre-start db is NOT spurious activity", () => {
      const startedAt = Date.now() - 1000;
      // db last written 60s BEFORE iteration start (another session's leftovers)
      makeDb(UUID, [[0, 3]]);
      utimesSync(join(root, "conversations", `${UUID}.db`), new Date(startedAt - 60000), new Date(startedAt - 60000));
      const probe = makeAgyLivenessProbe();
      probe({ pid: 0, startedAt }); // pre-spawn priming
      const v = probe({ pid: 1, startedAt });
      expect("active" in v && v.active).toBe(false);
   });

   test("activity resumes when steps table grows", () => {
      const probe = makeAgyLivenessProbe();
      const ctx = { pid: 1, startedAt: Date.now() - 1000 };
      probe({ pid: 0, startedAt: ctx.startedAt });
      makeDb(UUID, [[0, 3]]);
      probe(ctx); // resolve + first fingerprint (active)
      probe(ctx); // quiet

      const db = new Database(join(root, "conversations", `${UUID}.db`));
      db.query("INSERT INTO steps (idx, status) VALUES (1, 8)").run();
      db.close();

      const after = probe(ctx);
      expect("active" in after && after.active).toBe(true);
   });

   test("db-wal mtime change alone counts as activity", () => {
      const probe = makeAgyLivenessProbe();
      const ctx = { pid: 1, startedAt: Date.now() - 1000 };
      probe({ pid: 0, startedAt: ctx.startedAt });
      makeDb(UUID, [[0, 3]]);
      probe(ctx);
      probe(ctx); // quiet
      const wal = join(root, "conversations", `${UUID}.db-wal`);
      writeFileSync(wal, "x");
      utimesSync(wal, new Date(), new Date(Date.now() + 5000));
      const after = probe(ctx);
      expect("active" in after && after.active).toBe(true);
   });

   test("probe never throws on missing dirs", () => {
      const probe = makeAgyLivenessProbe();
      const ctx = { pid: 1, startedAt: Date.now() };
      expect(() => probe(ctx)).not.toThrow();
   });
});
