import type { WeatherKind, WorldWeather } from "@galahad/core/world";
import { z } from "zod";

/*
 * The weather the SANDBOX shows: Denmark's, now. One fixed request to Open-Meteo
 * for DMI's own model (HARMONIE) at Copenhagen: no key, no cookies, nothing about
 * you in it, redirects refused, the answer checked before anything uses it. Asked
 * only while someone has the world open, at most every 15 minutes (5 after a
 * failure). GALAHAD_WEATHER=off turns it off.
 */

export const WEATHER_PLACE = "Copenhagen";
export const WEATHER_SOURCE = "DMI HARMONIE via Open-Meteo";
export const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=55.676&longitude=12.568" +
  "&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility" +
  "&models=dmi_seamless&wind_speed_unit=ms&timezone=GMT";

const REFRESH_MS = 15 * 60_000;
const RETRY_MS = 5 * 60_000;
/** Older than this, the weather isn't shown any more. */
const STALE_MS = 3 * 3600_000;
const MAX_BYTES = 64 * 1024;

const Answer = z.object({
  current: z.object({
    // GMT, to the minute.
    time: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/),
    interval: z.number().int().min(60).max(86_400).optional(),
    weather_code: z.number().int().min(0).max(99),
    temperature_2m: z.number().finite().min(-60).max(60),
    relative_humidity_2m: z.number().finite().min(0).max(100),
    precipitation: z.number().finite().min(0).max(500),
    cloud_cover: z.number().finite().min(0).max(100),
    wind_speed_10m: z.number().finite().min(0).max(120),
    wind_direction_10m: z.number().finite().min(0).max(360).nullish(),
    visibility: z.number().finite().min(0).max(1_000_000).nullish(),
  }),
});

/** The world's weather for a WMO code (as Open-Meteo gives it); poor visibility without rain is mist. */
export function weatherKind(code: number, visibility: number | null | undefined): WeatherKind {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code === 45 || code === 48 || (visibility != null && visibility < 1000)) return "mist";
  if (code === 3) return "overcast";
  if (code === 2) return "cloudy";
  return "clear";
}

/** An answer from Open-Meteo, checked and read into the world's weather; null if it's not one. */
export function readWeather(body: unknown): WorldWeather | null {
  const parsed = Answer.safeParse(body);
  if (!parsed.success) return null;
  const c = parsed.data.current;
  const observed = Date.parse(`${c.time}:00Z`);
  if (!Number.isFinite(observed)) return null;
  const perHour = 3600 / (c.interval ?? 3600);
  return {
    kind: weatherKind(c.weather_code, c.visibility),
    cloud: c.cloud_cover / 100,
    precipitation: Math.round(c.precipitation * perHour * 100) / 100,
    visibility: c.visibility ?? null,
    wind: c.wind_speed_10m,
    windFrom: c.wind_direction_10m ?? null,
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m / 100,
    observed,
    place: WEATHER_PLACE,
    source: WEATHER_SOURCE,
  };
}

export interface WeatherOptions {
  enabled: boolean;
  fetch?: typeof fetch;
  now?: () => number;
  /** Whether anyone has the world open (it only asks then). */
  wanted?: () => boolean;
  /** The weather changed, or stopped being known. */
  onChange?: (weather: WorldWeather | null) => void;
  log?: (message: string) => void;
}

export class WeatherService {
  private last: WorldWeather | null = null;
  private lastOkAt = 0;
  private nextAt = 0;
  private shown: WorldWeather | null = null;
  private inflight: Promise<void> | null = null;
  private readonly timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: WeatherOptions) {
    if (opts.enabled) {
      this.timer = setInterval(() => this.tick(), 60_000);
      this.timer.unref?.();
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** The weather now, or null: unknown, turned off, or too old. */
  current(): WorldWeather | null {
    return this.last && this.now() - this.lastOkAt <= STALE_MS ? this.last : null;
  }

  /** Once a minute: fetch if someone's watching and it's due; tell watchers when it went stale. */
  tick(): void {
    if (!this.opts.enabled) return;
    this.announce();
    if (this.opts.wanted?.()) void this.refresh();
  }

  /** Fetch if due (one at a time). */
  refresh(): Promise<void> {
    if (!this.opts.enabled) return Promise.resolve();
    if (this.inflight) return this.inflight;
    const now = this.now();
    if (now < this.nextAt) return Promise.resolve();
    this.nextAt = now + RETRY_MS;
    this.inflight = this.fetchOnce()
      .then((weather) => {
        if (!weather) return;
        this.last = weather;
        this.lastOkAt = this.now();
        this.nextAt = this.lastOkAt + REFRESH_MS;
      })
      .catch((error: unknown) => this.opts.log?.(`weather: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.inflight = null;
        this.announce();
      });
    return this.inflight;
  }

  private async fetchOnce(): Promise<WorldWeather | null> {
    const response = await (this.opts.fetch ?? fetch)(WEATHER_URL, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error("Open-Meteo's answer was too big");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Open-Meteo's answer wasn't JSON");
    }
    const weather = readWeather(body);
    if (!weather) throw new Error("Open-Meteo's answer wasn't the weather");
    return weather;
  }

  /** Tells watchers when what's shown changed (new weather, or none). */
  private announce(): void {
    const now = this.current();
    if (now === this.shown) return;
    this.shown = now;
    this.opts.onChange?.(now);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
