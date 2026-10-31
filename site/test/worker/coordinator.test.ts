import { describe, expect, it } from "vitest";
import { RefreshCoordinator } from "../../worker/coordinator";
import type { RefreshResult } from "../../worker/session";

const ok = (n: number): RefreshResult => ({
  status: "ok",
  sealed: `S${n}`,
  accessToken: `T${n}`,
});
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe("RefreshCoordinator (single-use refresh tokens)", () => {
  it("two tabs holding the same cookie cause ONE refresh, and both get the same answer", async () => {
    const c = new RefreshCoordinator();
    const g = gate();
    let calls = 0;
    const refresh = async () => (calls++, await g.p, ok(1));
    const a = c.run("OLD", refresh);
    const b = c.run("OLD", refresh);
    g.open();
    expect(await a).toEqual(ok(1));
    expect(await b).toEqual(ok(1));
    expect(calls).toBe(1);
  });

  it("refreshes are strictly one at a time", async () => {
    const c = new RefreshCoordinator();
    let active = 0;
    let max = 0;
    const work = (n: number) => async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return ok(n);
    };
    await Promise.all([
      c.run("A", work(1)),
      c.run("B", work(2)),
      c.run("C", work(3)),
    ]);
    expect(max).toBe(1);
  });

  it("a caller holding the NEW cookie refreshes again (that is a real second renewal)", async () => {
    const c = new RefreshCoordinator();
    let calls = 0;
    await c.run("OLD", async () => (calls++, ok(1)));
    await c.run("S1", async () => (calls++, ok(2)));
    expect(calls).toBe(2);
  });

  it("only a success is reused: a retryable failure is tried again, a denial is not replayed as success", async () => {
    const c = new RefreshCoordinator();
    let calls = 0;
    const r1 = await c.run(
      "OLD",
      async () => (calls++, { status: "retry" } as RefreshResult),
    );
    const r2 = await c.run("OLD", async () => (calls++, ok(1)));
    expect(r1.status).toBe("retry");
    expect(r2).toEqual(ok(1));
    expect(calls).toBe(2);
  });

  it("forgets the answer after the reuse window", async () => {
    let t = 0;
    const c = new RefreshCoordinator(() => t, 1000);
    let calls = 0;
    await c.run("OLD", async () => (calls++, ok(1)));
    t = 1001;
    await c.run("OLD", async () => (calls++, ok(2)));
    expect(calls).toBe(2);
  });

  it("a thrown refresh does not wedge the queue", async () => {
    const c = new RefreshCoordinator();
    await expect(
      c.run("A", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await c.run("B", async () => ok(1))).toEqual(ok(1));
  });
});
