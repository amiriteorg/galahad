import { describe, expect, test } from "bun:test";
import { ACTIVITIES } from "@galahad/core/life";
import { STATIONS, type Station } from "@galahad/core/world";
import { ABSENCE_MS, danishHour, type GreetingInput, greetingLine, shouldGreet } from "./greeting.ts";

/*
 * He notices you: the line he says (the hour in Denmark, what he's at, one more
 * thing if there is one), and when a greeting is due (once a visit, again after a
 * long absence).
 */

/** 2026-11-12 at that hour in Denmark (CET: UTC+1 in November). */
const at = (hour: number, minute = 0): number => Date.UTC(2026, 10, 12, hour - 1, minute);
const input = (over: Partial<GreetingInput> = {}): GreetingInput => ({ now: at(8), activity: "walk", station: null, asleep: false, lying: false, quest: false, needsYou: false, weather: null, dog: "", ...over });

describe("what he says", () => {
  test("the hour's greeting is Denmark's, whatever the device's zone", () => {
    expect(danishHour(at(8, 30))).toBeCloseTo(8.5, 5);
    // Summer time: 14:00 in Denmark is 12:00 UTC.
    expect(danishHour(Date.UTC(2026, 6, 1, 12, 0))).toBeCloseTo(14, 5);
    const said = (hour: number) => greetingLine(input({ now: at(hour) }))!.split(".")[0];
    expect(said(6)).toBe("Good morning, my liege");
    expect(said(11)).toBe("Good day, my liege");
    expect(said(14)).toBe("Good afternoon, my liege");
    expect(said(20)).toBe("Good evening, my liege");
    expect(said(23.5)).toBe("You're up late, my liege");
    expect(said(3)).toBe("You're up late, my liege");
  });

  test("it fits what he's doing, with the dog's name once it has one", () => {
    expect(greetingLine(input())).toBe("Good morning, my liege. The dog and I are out on the trail.");
    expect(greetingLine(input({ dog: "Bors" }))).toBe("Good morning, my liege. Bors and I are out on the trail.");
    expect(greetingLine(input({ now: at(21), activity: "hearth", dog: "Bors" }))).toBe("Good evening, my liege. Bors and I are by the fire.");
    expect(greetingLine(input({ now: at(21, 40), activity: "journal" }))).toBe("Good evening, my liege. I'm writing up the day.");
    expect(greetingLine(input({ now: at(6, 20), activity: "wake", lying: true, dog: "Bors" }))).toBe("Good morning, my liege. Bors has just woken me.");
    expect(greetingLine(input({ now: at(13), activity: "walk-dog" }))).toBe("Good afternoon, my liege. The dog and I are playing fetch.");
  });

  test("every part of his day and every station has its own line: a sentence, never empty", () => {
    const seen = new Set<string>();
    for (const activity of ACTIVITIES) {
      const line = greetingLine(input({ activity }))!;
      expect(line).toMatch(/^Good morning, my liege\. [A-Z].+\.$/);
      seen.add(line);
    }
    expect(seen.size).toBe(ACTIVITIES.length);
    for (const station of [...Object.keys(STATIONS), "field"] as Station[]) expect(greetingLine(input({ activity: null, station }))).toMatch(/^Good morning, my liege\. I'm .+\.$/);
  });

  test("at work he says where, never what it's about; a quest in hand is said", () => {
    expect(greetingLine(input({ activity: null, station: "treasury" }))).toBe("Good morning, my liege. I'm at the treasury.");
    expect(greetingLine(input({ activity: null, station: "council", quest: true }))).toBe("Good morning, my liege. A quest is in hand: its plan is on my slate.");
    expect(greetingLine(input({ activity: null, station: "forge", quest: true }))).toBe("Good morning, my liege. A quest is in hand. I'm at work at the forge.");
  });

  test("one more thing, if there is one: what needs you before the weather; only weather worth a remark", () => {
    expect(greetingLine(input({ weather: "rain" }))).toBe("Good morning, my liege. The dog and I are out on the trail. It's raining here.");
    expect(greetingLine(input({ weather: "storm", needsYou: true }))).toBe("Good morning, my liege. The dog and I are out on the trail. Something needs you: it's in your Inbox.");
    expect(greetingLine(input({ weather: "snow", activity: "hearth" }))).toContain("It's snowing here.");
  });

  test("asleep he says nothing", () => {
    expect(greetingLine(input({ now: at(2), activity: "sleep", asleep: true }))).toBeNull();
    // Turning in, still awake: he does.
    expect(greetingLine(input({ now: at(22), activity: "sleep", lying: true }))).toBe("Good evening, my liege. I'm turning in for the night.");
  });
});

describe("when a greeting is due", () => {
  test("the first time; not on coming back to the page soon after; again after half an hour away", () => {
    const now = at(9);
    expect(shouldGreet(now, null)).toBe(true);
    expect(shouldGreet(now, now - 5_000)).toBe(false);
    expect(shouldGreet(now, now - ABSENCE_MS + 1)).toBe(false);
    expect(shouldGreet(now, now - ABSENCE_MS)).toBe(true);
    expect(shouldGreet(now, now - 8 * 3_600_000)).toBe(true);
  });

  test("a time that can't be right (a clock put back, a broken value) is a greeting, not silence for good", () => {
    const now = at(9);
    expect(shouldGreet(now, Number.NaN)).toBe(true);
    expect(shouldGreet(now, now + 3_600_000)).toBe(true);
    // (A few seconds' skew between tabs isn't a clock put back.)
    expect(shouldGreet(now, now + 2_000)).toBe(false);
  });
});
