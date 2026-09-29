/* 地点和天气 → a day's weather from 和风天气 (QWeather), as Chinese forecasts say it ("多云转小雨 15~25°"): the
   forecast's day and night for today and the week ahead; for the last ten days the hours the time machine
   (/v7/historical) kept, the morning (6–13) and the afternoon and evening (14–21) each by what most of it was.
   Asked here so the key stays in the Worker. { weather } or an error; without a key: 404 { off: true }, and the
   admin asks Open-Meteo. */
const QW_SAID: Record<string, string> = {
  "204": "那一天那里没有天气数据", "400": "请求不对", "401": "和风天气的 KEY 不对", "402": "和风天气的额度用完了",
  "403": "这个 KEY 没有这项服务（或 API Host 不对）", "404": "那一天那里没有天气数据", "429": "和风天气说请求太频繁",
};
export async function qweatherDay(key: string, host: string, date: string, lat: number, lon: number, today: string) {
  const h = host || "devapi.qweather.com", legacy = /^(?:dev)?api\.qweather\.com$/.test(h);
  const loc = lon.toFixed(2) + "," + lat.toFixed(2);
  const ask = async (base: string, path: string) => {
    const r = await fetch("https://" + base + path, { headers: { "X-QW-Api-Key": key, accept: "application/json" } });
    const j = (await r.json().catch(() => null)) as ({ code?: string } & Record<string, unknown>) | null;
    const code = j?.code || String(r.status);
    if (code !== "200") { const e = new Error(QW_SAID[code] || "和风天气没答上来（" + code + "）"); (e as Error & { code?: string }).code = code; throw e; }
    return j as Record<string, unknown>;
  };
  const span = (a: number, b: number) => (a === b ? String(b) : a + "~" + b) + "°";
  const days = (Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 864e5;
  if (days > 6) throw new Error("太远的日子还查不到天气");
  if (days >= 0) {
    // the week ahead (7d; a plan with only 3d)
    const j = await ask(h, "/v7/weather/7d?location=" + loc).catch((e) => (e.code === "403" ? ask(h, "/v7/weather/3d?location=" + loc) : Promise.reject(e)));
    type D = { fxDate: string; textDay: string; textNight: string; tempMax: string; tempMin: string };
    const d = ((j.daily || []) as D[]).find((x) => x.fxDate === date);
    if (!d) throw new Error("那一天的天气还没有");
    return (d.textDay === d.textNight ? d.textDay : d.textDay + "转" + d.textNight) + " " + span(Math.round(+d.tempMin), Math.round(+d.tempMax));
  }
  if (days < -10) throw new Error("和风天气只存最近 10 天");
  // the time machine wants the place's LocationID
  const g = await ask(legacy ? "geoapi.qweather.com" : h, (legacy ? "/v2" : "/geo/v2") + "/city/lookup?number=1&location=" + loc);
  const id = ((g.location || []) as { id?: string }[])[0]?.id;
  if (!id) throw new Error("和风天气没认出这个地方");
  const w = await ask(legacy ? "datasetapi.qweather.com" : h, "/v7/historical/weather?location=" + id + "&date=" + date.replace(/-/g, ""));
  const dd = (w.weatherDaily || {}) as { tempMax?: string; tempMin?: string };
  const hours = ((w.weatherHourly || []) as { time: string; text: string }[]).map((x) => ({ at: +(/T(\d\d)/.exec(x.time)?.[1] ?? -1), text: x.text }));
  const most = (hs: { text: string }[]) => {
    const n = new Map<string, number>();
    hs.forEach((x) => n.set(x.text, (n.get(x.text) || 0) + 1));
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  };
  const am = most(hours.filter((x) => x.at >= 6 && x.at <= 13)), pm = most(hours.filter((x) => x.at >= 14 && x.at <= 21));
  const text = am && pm && am !== pm ? am + "转" + pm : am || pm;
  if (!text || dd.tempMax == null) throw new Error("那一天那里没有天气数据");
  return text + " " + span(Math.round(+(dd.tempMin ?? dd.tempMax)), Math.round(+dd.tempMax));
}
