import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Anything Happened? — Kerala Community Disaster Watch" },
      {
        name: "description",
        content:
          "Real-time community reporting for floods, landslides, road damage, power failures and public safety across Kerala.",
      },
    ],
  }),
  component: Home,
});

type Severity = "safe" | "warn" | "critical";
type District = { code: string; name: string; severity: Severity; load: number };
type WeatherItem = { name: string; condition: string; temp: number; severity: Severity };
type Report = { id: string; district: string; created_at: string; message: string; severity: Severity };

const DISTRICTS: District[] = [
  { code: "KL-01", name: "Trivandrum", severity: "safe", load: 0.75 },
  { code: "KL-02", name: "Kollam", severity: "safe", load: 1 },
  { code: "KL-03", name: "P'thitta", severity: "warn", load: 0.33 },
  { code: "KL-04", name: "Alappuzha", severity: "safe", load: 0.83 },
  { code: "KL-05", name: "Kottayam", severity: "safe", load: 0.66 },
  { code: "KL-06", name: "Idukki", severity: "critical", load: 0.5 },
  { code: "KL-07", name: "Ernakulam", severity: "warn", load: 0.25 },
  { code: "KL-08", name: "Thrissur", severity: "safe", load: 0.5 },
  { code: "KL-09", name: "Palakkad", severity: "warn", load: 0.75 },
  { code: "KL-10", name: "Malappuram", severity: "safe", load: 1 },
  { code: "KL-11", name: "Kozhikode", severity: "warn", load: 0.2 },
  { code: "KL-12", name: "Wayanad", severity: "critical", load: 1 },
  { code: "KL-13", name: "Kannur", severity: "safe", load: 1 },
  { code: "KL-14", name: "Kasaragod", severity: "safe", load: 1 },
];

const WEATHER: WeatherItem[] = [
  { name: "Idukki", condition: "Thunderstorm warning", temp: 25, severity: "warn" },
  { name: "Kollam", condition: "Drizzle likely", temp: 29, severity: "safe" },
  { name: "Kottayam", condition: "Clear", temp: 31, severity: "safe" },
  { name: "Wayanad", condition: "Heavy rain alert", temp: 22, severity: "critical" },
  { name: "Palakkad", condition: "Heat advisory", temp: 36, severity: "warn" },
  { name: "Ernakulam", condition: "Overcast", temp: 29, severity: "safe" },
  { name: "Thrissur", condition: "Thunderstorm warning", temp: 30, severity: "warn" },
  { name: "Kannur", condition: "Rain showers", temp: 29, severity: "safe" },
  { name: "Kasaragod", condition: "Rain showers", temp: 29, severity: "safe" },
];

const REPORTS: Report[] = [
  { district: "Kochi", time: "14:15", message: "Minor waterlogging on MG Road.", severity: "warn" },
  { district: "Thrissur", time: "14:02", message: "Main Highway cleared of debris.", severity: "safe" },
  { district: "Alappuzha", time: "13:45", message: "Ferry services suspended temporarily.", severity: "safe" },
  { district: "Idukki", time: "13:20", message: "Hairline fissures reported on Munnar Gap Road.", severity: "critical" },
];

const severityColor = (s: Severity) =>
  s === "critical" ? "bg-critical" : s === "warn" ? "bg-warn" : "bg-primary";

const severityText = (s: Severity) =>
  s === "critical" ? "text-critical" : s === "warn" ? "text-warn" : "text-primary";

function useLocalTime() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const ist = new Date(d.getTime() + (5.5 * 60 + d.getTimezoneOffset()) * 60000);
      setTime(`${ist.getHours().toString().padStart(2, "0")}:${ist.getMinutes().toString().padStart(2, "0")} IST`);
    };
    fmt();
    const id = setInterval(fmt, 30000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function Home() {
  const time = useLocalTime();
  const tickerItems = [...WEATHER, ...WEATHER];

  return (
    <div className="min-h-screen w-full bg-background text-foreground p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex justify-between items-end border-b border-surface pb-6 gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-extrabold uppercase leading-none">
              Anything Happened?
            </h1>
            <p className="font-display text-primary text-xs sm:text-sm uppercase tracking-widest font-bold">
              Kerala Community Disaster Watch
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button className="font-display text-[10px] uppercase tracking-widest border border-surface px-2 py-1 hover:border-primary transition-colors">
              EN
            </button>
            <div className="hidden md:block text-right">
              <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                Local Time
              </div>
              <div className="font-display text-base font-bold tabular-nums">{time || "—"}</div>
            </div>
          </div>
        </header>

        {/* Weather Ticker */}
        <div className="bg-surface border-y border-primary/20 overflow-hidden py-3">
          <div className="flex whitespace-nowrap gap-8 font-display text-xs uppercase font-bold tracking-wider animate-ticker w-max">
            {tickerItems.map((w, i) => (
              <span key={i} className="flex items-center gap-2">
                <span className={severityText(w.severity)}>●</span>
                <span className="text-foreground">{w.name}:</span>
                <span className="text-muted-foreground">
                  {w.condition} {w.temp}°C
                </span>
                <span className="text-muted-foreground/40 ml-4">|</span>
              </span>
            ))}
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Featured + Actions */}
          <div className="lg:col-span-8 space-y-6">
            {/* Critical Lede */}
            <article className="relative bg-critical/10 border-l-4 border-critical p-6">
              <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
                <span className="font-display bg-critical text-critical-foreground px-3 py-1 text-xs font-bold uppercase tracking-widest">
                  Critical Alert
                </span>
                <span className="text-xs text-muted-foreground font-display">2 mins ago</span>
              </div>
              <h2 className="font-display text-2xl md:text-3xl font-bold mb-3 leading-tight">
                Wayanad: Precautionary Evacuation Order for Meppadi Region
              </h2>
              <p className="text-base md:text-lg text-foreground/80 mb-6">
                Due to sustained heavy rainfall, residents in high-risk zones of Meppadi are advised
                to move to designated relief camps immediately.
              </p>
              <button className="font-display flex items-center gap-2 text-primary font-bold uppercase text-sm tracking-widest hover:underline">
                Read Full Protocol →
              </button>
            </article>

            {/* Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button className="flex flex-col items-start p-6 bg-surface border border-warn/30 hover:border-warn transition-all text-left group">
                <div className="w-10 h-10 rounded-full bg-warn/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <div className="w-4 h-4 bg-warn rotate-45" />
                </div>
                <span className="font-display text-xl font-bold mb-1 uppercase tracking-tight">
                  Report Alert
                </span>
                <span className="text-sm text-muted-foreground">
                  Floods, landslides, road damage, power failures, or risks.
                </span>
              </button>

              <button className="flex flex-col items-start p-6 bg-surface border border-primary/30 hover:border-primary transition-all text-left group">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <div className="w-4 h-4 border-2 border-primary rounded-sm" />
                </div>
                <span className="font-display text-xl font-bold mb-1 uppercase tracking-tight">
                  Mark Safe
                </span>
                <span className="text-sm text-muted-foreground">
                  Confirm an area is safe or a previous report resolved.
                </span>
              </button>
            </div>

            {/* Location search */}
            <div className="bg-surface p-6">
              <label className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground mb-3 font-bold">
                Choose Your Location
              </label>
              <input
                type="text"
                placeholder="Search your place (e.g. Payyannur, Maniyara...)"
                className="w-full bg-background border border-surface focus:border-primary px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          {/* Right: Stats + Live Feed */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-surface p-6">
              <h3 className="font-display text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
                Kerala Overview
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <Stat value="12" label="Active Alerts" tone="warn" />
                <Stat value="142" label="Safe Points" tone="primary" />
                <Stat value="2.4k" label="Contributors" tone="muted" />
                <Stat value="0" label="Fatalities" tone="muted" />
              </div>
            </div>

            <div className="bg-surface flex flex-col h-[400px]">
              <div className="p-4 border-b border-background/40 flex justify-between items-center">
                <h3 className="font-display text-xs font-bold uppercase tracking-widest">
                  Live Reports
                </h3>
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {REPORTS.map((r, i) => (
                  <div
                    key={i}
                    className={`border-l-2 pl-3 py-1 ${
                      r.severity === "critical"
                        ? "border-critical"
                        : r.severity === "warn"
                          ? "border-warn"
                          : "border-primary"
                    }`}
                  >
                    <div className="font-display text-xs text-muted-foreground mb-1">
                      {r.district} • {r.time}
                    </div>
                    <div className="text-sm font-semibold">{r.message}</div>
                  </div>
                ))}
                <div className="text-center py-6 text-muted-foreground/40 italic text-xs">
                  End of recent reports
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* District Grid */}
        <section className="space-y-4 pt-8 border-t border-surface">
          <h3 className="font-display text-xs font-bold uppercase tracking-widest text-muted-foreground">
            All Districts
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-surface border border-surface">
            {DISTRICTS.map((d) => (
              <button
                key={d.code}
                className="bg-background p-4 hover:bg-surface transition-colors text-left"
              >
                <div className="font-display text-[10px] uppercase text-muted-foreground mb-2 font-bold">
                  {d.code}
                </div>
                <div className="font-display text-sm font-bold uppercase tracking-tight">
                  {d.name}
                </div>
                <div className="mt-4 h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${severityColor(d.severity)} ${d.severity === "critical" ? "animate-pulse" : ""}`}
                    style={{ width: `${Math.max(8, d.load * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </section>

        <footer className="pt-8 pb-4 text-center font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Community-powered · Built for Kerala
        </footer>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "warn" | "primary" | "muted";
}) {
  const color =
    tone === "warn" ? "text-warn" : tone === "primary" ? "text-primary" : "text-foreground/40";
  return (
    <div className="space-y-1">
      <div className={`font-display text-3xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
        {label}
      </div>
    </div>
  );
}
