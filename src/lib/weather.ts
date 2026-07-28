import type { ShootWindow } from '@/lib/types';

/**
 * HARDENED STEP — spec §10.1.
 *
 * This was originally an AI call with the web_search tool. Zapier's own
 * principle: "Once a workflow proves useful, steps should move from AI
 * judgment toward deterministic automation where consistency, control,
 * measurability, and fixability matter more than flexibility... the
 * weather/shoot-window lookup is a candidate to harden into a plain
 * deterministic API call — it's not really a judgment call, it's a data
 * fetch."
 *
 * It isn't a judgment call, and the AI version proved it: it twice failed to
 * find a forecast, and once returned a date from the previous month. This
 * version cannot do either. Open-Meteo is free, needs no API key, and returns
 * hourly cloud/wind/precipitation plus local sunrise/sunset.
 *
 * The WMO weather codes below are the same ones the reference prototype in
 * spec §6 already carried — that prototype was written against this data
 * shape before falling back to search.
 */

const WMO: Record<number, string> = {
  0: 'clear sky',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'freezing fog',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'rain showers',
  82: 'violent rain showers',
  95: 'thunderstorms',
  96: 'thunderstorms with hail',
  99: 'thunderstorms with hail',
};

/** Beyond this, flying is unpleasant-to-unsafe for a consumer airframe. */
const WIND_MARGINAL_KMH = 30;
/** Codes that mean "do not plan a shoot on this day at all". */
const DISQUALIFYING_CODES = new Set([65, 75, 82, 95, 96, 99]);

interface DayForecast {
  date: string;
  code: number;
  cloudPct: number;
  windKmh: number;
  rainPct: number;
  sunrise: string;
  sunset: string;
  score: number;
}

export interface WeatherLookupFailure {
  insufficientData: true;
  reason: string;
}

/**
 * Lower is better. Rain is weighted hardest (it cancels a shoot outright),
 * then wind (safety + stability), then cloud (only affects light quality —
 * and light overcast is actually flattering, so it's the mildest penalty).
 */
function scoreDay(d: Omit<DayForecast, 'score'>): number {
  return d.rainPct * 1.0 + d.windKmh * 2.0 + d.cloudPct * 0.4;
}

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

function addMinutes(hhmmStr: string, minutes: number): string {
  const [h, m] = hhmmStr.split(':').map(Number);
  const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export async function fetchShootWindow(
  lat: number,
  lon: number,
): Promise<ShootWindow | WeatherLookupFailure> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily:
      'weather_code,precipitation_probability_max,wind_speed_10m_max,cloud_cover_mean,sunrise,sunset',
    hourly: 'cloud_cover,wind_speed_10m,precipitation_probability',
    timezone: 'America/New_York',
    forecast_days: '6',
  });

  let payload: {
    daily?: {
      time: string[];
      weather_code: number[];
      precipitation_probability_max: (number | null)[];
      wind_speed_10m_max: (number | null)[];
      cloud_cover_mean: (number | null)[];
      sunrise: string[];
      sunset: string[];
    };
    hourly?: {
      time: string[];
      cloud_cover: (number | null)[];
      wind_speed_10m: (number | null)[];
      precipitation_probability: (number | null)[];
    };
  };

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      return { insufficientData: true, reason: `Open-Meteo returned HTTP ${res.status}` };
    }
    payload = await res.json();
  } catch (err) {
    return {
      insufficientData: true,
      reason: `Could not reach Open-Meteo: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const daily = payload.daily;
  if (!daily?.time?.length) {
    return { insufficientData: true, reason: 'Open-Meteo returned no daily forecast.' };
  }

  // Only consider today onward, and skip today if the sun has already set.
  const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' });
  const todayIso = nowLocal.slice(0, 10);
  const nowHhmm = nowLocal.slice(11, 16);

  const days: DayForecast[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const date = daily.time[i];
    if (date < todayIso) continue;

    const sunset = hhmm(daily.sunset[i]);
    // Need at least an hour of usable light left to be worth planning.
    if (date === todayIso && nowHhmm >= addMinutes(sunset, -60)) continue;

    const code = daily.weather_code[i] ?? 3;
    if (DISQUALIFYING_CODES.has(code)) continue;

    const base = {
      date,
      code,
      cloudPct: daily.cloud_cover_mean[i] ?? 50,
      windKmh: daily.wind_speed_10m_max[i] ?? 0,
      rainPct: daily.precipitation_probability_max[i] ?? 0,
      sunrise: hhmm(daily.sunrise[i]),
      sunset,
    };
    days.push({ ...base, score: scoreDay(base) });
  }

  if (!days.length) {
    return {
      insufficientData: true,
      reason:
        'No flyable day in the next 6 days — every day is forecast for heavy rain, ' +
        'thunderstorms, or heavy snow.',
    };
  }

  days.sort((a, b) => a.score - b.score);
  const best = days[0];

  // --- Pick the flight window on that day ---------------------------------
  // Golden hour (the ~90 min before sunset) is the default for exterior real
  // estate. Fall back to late morning if the evening is specifically windy.
  let startLocal = addMinutes(best.sunset, -105);
  let endLocal = addMinutes(best.sunset, -15);
  let windowNote = 'golden-hour light in the 90 minutes before sunset';

  const hourly = payload.hourly;
  let goldenWind: number | null = null;
  if (hourly?.time?.length) {
    const windows = hourly.time
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.slice(0, 10) === best.date)
      .filter(({ t }) => {
        const hh = t.slice(11, 16);
        return hh >= startLocal && hh <= endLocal;
      });

    const winds = windows
      .map(({ idx }) => hourly.wind_speed_10m[idx])
      .filter((w): w is number => w != null);

    if (winds.length) {
      goldenWind = Math.max(...winds);
      if (goldenWind > WIND_MARGINAL_KMH) {
        // Evening is gusty — take mid-morning instead, when wind is usually
        // lightest, and say so rather than silently flying in bad air.
        startLocal = addMinutes(best.sunrise, 120);
        endLocal = addMinutes(best.sunrise, 210);
        windowNote =
          `mid-morning instead of golden hour, because evening winds reach ` +
          `${Math.round(goldenWind)} km/h near sunset`;
      }
    }
  }

  const conditions = WMO[best.code] ?? 'mixed conditions';

  // Rationale is built from the actual numbers, not generated — so it can
  // never describe weather the forecast didn't contain.
  const parts = [
    `Best of the next ${days.length} flyable days: ${conditions}`,
    `${Math.round(best.cloudPct)}% mean cloud`,
    `winds to ${Math.round(best.windKmh)} km/h`,
    `${Math.round(best.rainPct)}% chance of precipitation`,
  ];
  let timeRationale = `${parts.join(', ')}. Chose ${windowNote} (sunset ${best.sunset}).`;

  if (best.rainPct >= 40) {
    timeRationale += ` Note: this is the best available day but rain risk is still elevated — worth reconfirming closer to the date.`;
  }
  if (best.windKmh > WIND_MARGINAL_KMH && goldenWind == null) {
    timeRationale += ` Note: daily peak winds exceed ${WIND_MARGINAL_KMH} km/h — check conditions before flying.`;
  }

  return {
    dateIso: best.date,
    date: new Date(`${best.date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    conditions,
    windKmh: Math.round(best.windKmh),
    sunrise: best.sunrise,
    sunset: best.sunset,
    startLocal,
    endLocal,
    timeRationale,
  };
}
