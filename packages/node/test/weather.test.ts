import { describe, expect, test } from "bun:test";
import type { WorldEvent, WorldWeather } from "@galahad/core/world";
import { readWeather, WEATHER_URL, WeatherService, weatherKind } from "../src/weather.ts";
import { WorldHub } from "../src/world-hub.ts";

// What Open-Meteo answered for Copenhagen (DMI's model) on 2026-11-10 at 17:45 (times in GMT here).
const SAMPLE = {
  latitude: 55.680347,
  longitude: 12.562759,
  utc_offset_seconds: 0,
  timezone: "GMT",
  current: {
    time: "2026-11-10T16:45",
    interval: 900,
    temperature_2m: 6.8,
    relative_humidity_2m: 84,
    precipitation: 0,
    weather_code: 3,
    cloud_cover: 92,
    wind_speed_10m: 1.6,
    wind_direction_10m: 250,
    visibility: 20760,
  },
};

function fakeFetch(answers: (() => Response)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the weather in Denmark", () => {
  test("WMO codes become the world's weather; poor visibility is mist", () => {
    expect(weatherKind(0, 30000)).toBe("clear");
    expect(weatherKind(1, null)).toBe("clear");
    expect(weatherKind(2, null)).toBe("cloudy");
    expect(weatherKind(3, 20000)).toBe("overcast");
    expect(weatherKind(45, null)).toBe("mist");
    expect(weatherKind(3, 600)).toBe("mist");
    expect(weatherKind(53, 3000)).toBe("drizzle");
    expect(weatherKind(63, 3000)).toBe("rain");
    expect(weatherKind(81, null)).toBe("rain");
    expect(weatherKind(73, null)).toBe("snow");
    expect(weatherKind(86, null)).toBe("snow");
    expect(weatherKind(95, null)).toBe("storm");
  });

  test("an answer is read into the contract's shape, with units the world uses", () => {
    const w = readWeather(SAMPLE)!;
    expect(w).toEqual({
      kind: "overcast",
      cloud: 0.92,
      precipitation: 0,
      visibility: 20760,
      wind: 1.6,
      windFrom: 250,
      temperature: 6.8,
      humidity: 0.84,
      observed: Date.UTC(2026, 10, 10, 16, 45),
      place: "Copenhagen",
      source: "DMI HARMONIE via Open-Meteo",
    });
    // A quarter hour's precipitation becomes mm an hour.
    expect(readWeather({ current: { ...SAMPLE.current, precipitation: 0.5, weather_code: 61 } })!.precipitation).toBe(2);
  });

  test("anything malformed or out of range is refused", () => {
    expect(readWeather(null)).toBeNull();
    expect(readWeather({})).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, weather_code: "3" } })).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, temperature_2m: 9000 } })).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, cloud_cover: Number.NaN } })).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, time: "yesterday" } })).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, weather_code: 3.5 } })).toBeNull();
    expect(readWeather({ current: { ...SAMPLE.current, wind_direction_10m: 400 } })).toBeNull();
    // A model that doesn't give the wind's direction: the rest of the weather still stands.
    const { wind_direction_10m: _gone, ...without } = SAMPLE.current;
    expect(readWeather({ current: without })?.windFrom).toBeNull();
  });

  test("it asks one fixed address that carries nothing about you, and refuses redirects", async () => {
    const { fn, calls } = fakeFetch([json(SAMPLE)]);
    const now = Date.UTC(2026, 10, 10, 17, 0);
    const changes: (WorldWeather | null)[] = [];
    const svc = new WeatherService({ enabled: true, fetch: fn, now: () => now, onChange: (w) => changes.push(w) });
    await svc.refresh();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEATHER_URL);
    expect(WEATHER_URL.startsWith("https://api.open-meteo.com/v1/forecast?latitude=55.676&longitude=12.568&")).toBe(true);
    expect(calls[0]!.init?.redirect).toBe("error");
    const headers = new Headers(calls[0]!.init?.headers);
    expect([...headers.keys()].sort()).toEqual(["accept"]);
    expect(svc.current()?.kind).toBe("overcast");
    expect(changes.map((w) => w?.kind)).toEqual(["overcast"]);
    svc.close();
  });

  test("at most one request every 15 minutes, one at a time; a failure retries after 5 and keeps the last good weather", async () => {
    let now = Date.UTC(2026, 10, 10, 17, 0);
    const { fn, calls } = fakeFetch([json(SAMPLE), json({ error: true }, 500), () => new Response("not json"), json({ current: { ...SAMPLE.current, weather_code: 63, precipitation: 1 } })]);
    const svc = new WeatherService({ enabled: true, fetch: fn, now: () => now });
    await Promise.all([svc.refresh(), svc.refresh(), svc.refresh()]);
    expect(calls).toHaveLength(1);
    now += 10 * 60_000;
    await svc.refresh();
    expect(calls).toHaveLength(1);
    now += 5 * 60_000;
    await svc.refresh(); // 500
    expect(calls).toHaveLength(2);
    expect(svc.current()?.kind).toBe("overcast");
    now += 4 * 60_000;
    await svc.refresh();
    expect(calls).toHaveLength(2);
    now += 60_000;
    await svc.refresh(); // not JSON
    expect(calls).toHaveLength(3);
    now += 5 * 60_000;
    await svc.refresh();
    expect(calls).toHaveLength(4);
    expect(svc.current()?.kind).toBe("rain");
    svc.close();
  });

  test("weather older than three hours is no longer shown", async () => {
    let now = Date.UTC(2026, 10, 10, 17, 0);
    const { fn } = fakeFetch([json(SAMPLE)]);
    const changes: (WorldWeather | null)[] = [];
    const svc = new WeatherService({ enabled: true, fetch: fn, now: () => now, onChange: (w) => changes.push(w) });
    await svc.refresh();
    now += 3 * 3600_000 + 1;
    expect(svc.current()).toBeNull();
    svc.tick();
    expect(changes.map((w) => w?.kind ?? null)).toEqual(["overcast", null]);
    svc.close();
  });

  test("turned off, it never asks", async () => {
    const { fn, calls } = fakeFetch([json(SAMPLE)]);
    const svc = new WeatherService({ enabled: false, fetch: fn });
    await svc.refresh();
    svc.tick();
    expect(calls).toHaveLength(0);
    expect(svc.current()).toBeNull();
    svc.close();
  });

  test("the world says the weather when you open it and when it changes; opening it asks for fresh weather", async () => {
    const hub = new WorldHub();
    let weather: WorldWeather | null = null;
    let woken = 0;
    hub.setWeather(
      () => weather,
      () => woken++,
    );
    expect((hub.hello() as Extract<WorldEvent, { type: "hello" }>).weather).toBeNull();
    const seen: WorldEvent[] = [];
    const stop = hub.watch((e) => seen.push(e));
    expect(woken).toBe(1);
    weather = readWeather(SAMPLE);
    hub.weatherChanged();
    expect(seen.map((e) => e.type)).toEqual(["weather"]);
    expect((seen[0] as Extract<WorldEvent, { type: "weather" }>).weather?.kind).toBe("overcast");
    expect((hub.hello() as Extract<WorldEvent, { type: "hello" }>).weather?.temperature).toBe(6.8);
    stop();
    hub.close();
  });
});
