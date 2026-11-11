import { describe, expect, test } from "bun:test";
import { ACTIVITIES, ACTIVITY_LABEL, type Activity, blockPhase, danishDate, dayPlan, intentFor, LIFE_SEED, lifeAt, ROUNDS, roundsStop } from "./life.ts";

/*
 * His day when there's no work: the same plan on every device for the same moment,
 * from Denmark's clock and a seed; covering the day end to end; resting at night;
 * work, then what needs you, then the dog's battery, before the plan; and after work
 * he picks the day up where it would be.
 */

const at = (iso: string) => Date.parse(iso);

describe("Denmark's clock", () => {
  test("the date and midnight in Copenhagen, summer and winter, whatever the device's zone", () => {
    // 11 November: UTC+1. 23:30 UTC is already the 12th in Denmark.
    expect(danishDate(at("2026-11-11T22:59:00Z"))).toEqual({ day: "2026-11-11", midnight: at("2026-11-10T23:00:00Z") });
    expect(danishDate(at("2026-11-11T23:30:00Z"))).toEqual({ day: "2026-11-12", midnight: at("2026-11-11T23:00:00Z") });
    // July: UTC+2.
    expect(danishDate(at("2026-07-01T12:00:00Z"))).toEqual({ day: "2026-07-01", midnight: at("2026-06-30T22:00:00Z") });
  });
});

describe("a day's plan", () => {
  const days = ["2026-11-11", "2026-11-12", "2026-12-24", "2027-03-29", "2027-06-21", "2027-10-31"];

  test("covers the day end to end, block after block, none empty, none repeated back to back", () => {
    for (const day of days) {
      const plan = dayPlan(day);
      expect(plan[0]!.from).toBe(0);
      expect(plan.at(-1)!.to).toBe(24 * 60);
      for (let i = 0; i < plan.length; i++) {
        expect(plan[i]!.to).toBeGreaterThan(plan[i]!.from);
        if (i) {
          expect(plan[i]!.from).toBe(plan[i - 1]!.to);
          expect(plan[i]!.activity).not.toBe(plan[i - 1]!.activity);
        }
      }
    }
  });

  test("rest at night, rounds and a walk with the dog in the morning, a walk at noon and at evening", () => {
    for (const day of days) {
      const plan = dayPlan(day);
      const what = (minute: number) => plan.find((b) => minute < b.to)!.activity;
      expect(what(3 * 60)).toBe("rest");
      expect(what(23 * 60 + 30)).toBe("rest");
      const order = plan.map((b) => b.activity);
      expect(order.slice(0, 3)).toEqual(["rest", "rounds", "walk-dog"]);
      expect(order.filter((a) => a === "walk-dog").length).toBe(3);
      expect(order.slice(-3)).toEqual(["council", "observatory", "rest"]);
      expect(plan.find((b) => b.activity === "rounds")!.from).toBeGreaterThanOrEqual(6 * 60 + 15);
      expect(plan.find((b) => b.activity === "rounds")!.from).toBeLessThanOrEqual(6 * 60 + 45);
    }
  });

  test("the same for the same day and seed; another day, another order", () => {
    expect(dayPlan("2026-11-11")).toEqual(dayPlan("2026-11-11", LIFE_SEED));
    expect(dayPlan("2026-11-11").map((b) => b.activity)).not.toEqual(dayPlan("2026-11-12").map((b) => b.activity));
    expect(dayPlan("2026-11-11", 1)).not.toEqual(dayPlan("2026-11-11", 2));
  });

  test("over a week, he does everything he does", () => {
    const seen = new Set<Activity>();
    for (let d = 1; d <= 7; d++) for (const b of dayPlan(`2026-11-0${d}`)) seen.add(b.activity);
    expect([...seen].sort()).toEqual([...ACTIVITIES].sort());
    for (const a of ACTIVITIES) expect(ACTIVITY_LABEL[a].length).toBeGreaterThan(5);
  });
});

describe("now", () => {
  test("the same block on every device at the same moment, whatever its own clock zone", () => {
    const now = at("2026-11-11T09:20:00Z");
    const a = lifeAt(now);
    const was = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(lifeAt(now)).toEqual(a);
      process.env.TZ = "Asia/Tokyo";
      expect(lifeAt(now)).toEqual(a);
    } finally {
      process.env.TZ = was;
    }
    expect(a.start).toBeLessThanOrEqual(now);
    expect(a.end).toBeGreaterThan(now);
  });

  test("at night he rests; in the morning, his rounds", () => {
    expect(lifeAt(at("2026-11-11T02:00:00Z")).activity).toBe("rest");
    const plan = dayPlan("2026-11-11");
    const rounds = plan.find((b) => b.activity === "rounds")!;
    const midnight = danishDate(at("2026-11-11T12:00:00Z")).midnight;
    expect(lifeAt(midnight + (rounds.from + 5) * 60_000).activity).toBe("rounds");
  });

  test("a block's phase runs from 0 to 1; the rounds walk every station in turn", () => {
    const b = { activity: "rounds" as const, start: 1000, end: 2000 };
    expect(blockPhase(b, 500)).toBe(0);
    expect(blockPhase(b, 1500)).toBe(0.5);
    expect(blockPhase(b, 9000)).toBe(1);
    expect(ROUNDS.map((_, i) => roundsStop((i + 0.5) / ROUNDS.length))).toEqual([...ROUNDS]);
    expect(roundsStop(1)).toBe("observatory");
  });
});

describe("work comes first", () => {
  test("work, then what needs you, then the dog's battery, then the day; under reduced motion he stays put", () => {
    expect(intentFor({ working: true, concern: true, dogLow: true, motion: true })).toBe("work");
    expect(intentFor({ working: false, concern: true, dogLow: true, motion: true })).toBe("concern");
    expect(intentFor({ working: false, concern: false, dogLow: true, motion: true })).toBe("charge");
    expect(intentFor({ working: false, concern: false, dogLow: false, motion: true })).toBe("life");
    expect(intentFor({ working: false, concern: true, dogLow: false, motion: false })).toBe("still");
    expect(intentFor({ working: true, concern: false, dogLow: false, motion: false })).toBe("work");
  });

  test("after work, he picks his day up where it would be: the block for now, not the one he left", () => {
    const morning = at("2026-11-11T07:00:00Z");
    const left = lifeAt(morning);
    // Two hours of work later.
    const back = lifeAt(morning + 2 * 60 * 60_000);
    expect(back.start).toBeGreaterThan(left.start);
    expect(back).toEqual(lifeAt(morning + 2 * 60 * 60_000));
    const plan = dayPlan("2026-11-11");
    const midnight = danishDate(morning).midnight;
    const minute = (morning + 2 * 60 * 60_000 - midnight) / 60_000;
    expect(back.activity).toBe(plan.find((b) => minute < b.to)!.activity);
  });
});
