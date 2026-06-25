import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getKeralaAlerts, type OfficialAlert } from "@/lib/alerts";

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
type District = {
  code: string;
  name: string;
  lat: number;
  lon: number;
};
type Report = {
  id: string;
  district: string;
  place: string | null;
  lat: number | null;
  lon: number | null;
  created_at: string;
  message: string;
  severity: Severity;
  category: string | null;
  image_url: string | null;
};

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
    district?: string;
  };
};

type Place = {
  name: string;
  context: string;
  lat: number;
  lon: number;
  district: string;
};

const DISTRICTS: District[] = [
  { code: "KL-01", name: "Trivandrum", lat: 8.5241, lon: 76.9366 },
  { code: "KL-02", name: "Kollam", lat: 8.8932, lon: 76.6141 },
  { code: "KL-03", name: "Pathanamthitta", lat: 9.2648, lon: 76.787 },
  { code: "KL-04", name: "Alappuzha", lat: 9.4981, lon: 76.3388 },
  { code: "KL-05", name: "Kottayam", lat: 9.5916, lon: 76.5222 },
  { code: "KL-06", name: "Idukki", lat: 9.85, lon: 76.97 },
  { code: "KL-07", name: "Ernakulam", lat: 9.9816, lon: 76.2999 },
  { code: "KL-08", name: "Thrissur", lat: 10.5276, lon: 76.2144 },
  { code: "KL-09", name: "Palakkad", lat: 10.7867, lon: 76.6548 },
  { code: "KL-10", name: "Malappuram", lat: 11.041, lon: 76.0788 },
  { code: "KL-11", name: "Kozhikode", lat: 11.2588, lon: 75.7804 },
  { code: "KL-12", name: "Wayanad", lat: 11.6854, lon: 76.132 },
  { code: "KL-13", name: "Kannur", lat: 11.8745, lon: 75.3704 },
  { code: "KL-14", name: "Kasaragod", lat: 12.4996, lon: 74.9869 },
];

const KERALA_CENTER = { lat: 10.5, lon: 76.3 };

const SEVERITY_RANK: Record<Severity, number> = { safe: 0, warn: 1, critical: 2 };

function maxSeverity(items: Array<{ severity: Severity }>): Severity {
  let best: Severity = "safe";
  for (const it of items) {
    if (SEVERITY_RANK[it.severity] > SEVERITY_RANK[best]) best = it.severity;
  }
  return best;
}


/* ---------------- helpers ---------------- */

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function resolveDistrict(f: PhotonFeature): string {
  const p = f.properties;
  const candidates = [p.district, p.county, p.city, p.state].filter(Boolean) as string[];
  for (const c of candidates) {
    const hit = DISTRICTS.find(
      (d) =>
        c.toLowerCase().includes(d.name.toLowerCase()) ||
        d.name.toLowerCase().includes(c.toLowerCase()),
    );
    if (hit) return hit.name;
  }
  const [lon, lat] = f.geometry.coordinates;
  let best = DISTRICTS[0];
  let bestDist = Infinity;
  for (const d of DISTRICTS) {
    const dist = haversine({ lat, lon }, d);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best.name;
}

function toPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const district = resolveDistrict(f);
  const ctxParts = [p.city, p.county, p.state].filter(Boolean) as string[];
  const context = Array.from(new Set(ctxParts)).join(" · ");
  return {
    name: p.name ?? "Unknown",
    context: context || "Kerala, India",
    lat,
    lon,
    district,
  };
}

function usePhotonSearch(query: string) {
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
        q,
      )}&lat=${KERALA_CENTER.lat}&lon=${KERALA_CENTER.lon}&limit=8`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: { features: PhotonFeature[] }) => {
          const features = (data.features ?? []).filter((f) => {
            const s = (f.properties.state ?? "").toLowerCase();
            const c = (f.properties.country ?? "").toLowerCase();
            return s.includes("kerala") || (c.includes("india") && s === "");
          });
          setResults(features.map(toPlace));
        })
        .catch((e) => {
          if (e.name !== "AbortError") console.error(e);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(id);
    };
  }, [query]);

  return { results, loading };
}

async function reverseGeocode(lat: number, lon: number): Promise<Place | null> {
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`,
    );
    const data: { features: PhotonFeature[] } = await res.json();
    const f = data.features?.[0];
    if (!f) return null;
    return toPlace(f);
  } catch {
    return null;
  }
}

function useLiveReports(limit = 20) {
  const [reports, setReports] = useState<Report[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase
      .from("reports")
      .select("id, district, place, lat, lon, message, severity, category, image_url, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("[reports] initial load failed", error);
          setStatus("offline");
          return;
        }
        setReports((data ?? []) as Report[]);
      });

    const channel = supabase
      .channel("reports-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reports" },
        (payload) => {
          const next = payload.new as Report;
          setReports((prev) => [next, ...prev].slice(0, limit));
          setFlashId(next.id);
          setTimeout(() => setFlashId((id) => (id === next.id ? null : id)), 4000);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reports" },
        (payload) => {
          const removed = payload.old as { id?: string };
          if (!removed?.id) return;
          setReports((prev) => prev.filter((r) => r.id !== removed.id));
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setStatus("live");
        else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("offline");
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { reports, status, flashId };
}

function formatReportTime(iso: string) {
  const d = new Date(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return d.toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

const severityColor = (s: Severity) =>
  s === "critical" ? "bg-critical" : s === "warn" ? "bg-warn" : "bg-primary";

const severityText = (s: Severity) =>
  s === "critical" ? "text-critical" : s === "warn" ? "text-warn" : "text-primary";

const severityBorder = (s: Severity) =>
  s === "critical" ? "border-critical" : s === "warn" ? "border-warn" : "border-primary";

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

/* signed-url cache for private bucket images */
function useSignedImage(pathOrUrl: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pathOrUrl) {
      setUrl(null);
      return;
    }
    if (pathOrUrl.startsWith("http")) {
      setUrl(pathOrUrl);
      return;
    }
    let active = true;
    supabase.storage
      .from("report-images")
      .createSignedUrl(pathOrUrl, 60 * 60)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error(error);
          return;
        }
        setUrl(data?.signedUrl ?? null);
      });
    return () => {
      active = false;
    };
  }, [pathOrUrl]);
  return url;
}

function useKeralaAlerts() {
  const [alerts, setAlerts] = useState<OfficialAlert[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let active = true;
    const load = () => {
      getKeralaAlerts()
        .then((data) => {
          if (!active) return;
          setAlerts(data);
          setStatus("ready");
        })
        .catch((err) => {
          console.error("[alerts] fetch failed", err);
          if (active) setStatus("error");
        });
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);
  return { alerts, status };
}

function formatAlertWindow(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/* ---------------- main page ---------------- */

function Home() {
  const time = useLocalTime();
  const { reports, status, flashId } = useLiveReports(40);
  const { alerts, status: alertStatus } = useKeralaAlerts();
  const tickerItems = useMemo(() => {
    if (alerts.length === 0) return [];
    return [...alerts, ...alerts];
  }, [alerts]);
  const topAlert = alerts[0] ?? null;


  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [districtFocus, setDistrictFocus] = useState<string | null>(null);

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

        {/* Official Alerts Ticker (NDMA Sachet / IMD / KSDMA) */}
        <div className="bg-surface border-y border-primary/20 overflow-hidden py-3">
          {tickerItems.length === 0 ? (
            <div className="font-display text-xs uppercase font-bold tracking-wider text-muted-foreground px-4">
              {alertStatus === "loading"
                ? "Fetching official advisories from NDMA Sachet…"
                : alertStatus === "error"
                  ? "Official advisory feed unavailable right now."
                  : "No active official advisories for Kerala right now."}
            </div>
          ) : (
            <div className="flex whitespace-nowrap gap-8 font-display text-xs uppercase font-bold tracking-wider animate-ticker w-max">
              {tickerItems.map((a, i) => (
                <span key={`${a.id}-${i}`} className="flex items-center gap-2">
                  <span className={severityText(a.severity)}>●</span>
                  <span className="text-foreground">
                    {a.district ?? "Kerala"}:
                  </span>
                  <span className="text-muted-foreground">
                    {a.disasterType} · {a.source}
                  </span>
                  <span className="text-muted-foreground/40 ml-4">|</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Featured + Location + Action */}
          <div className="lg:col-span-8 space-y-6">
            {/* Critical Lede — top official alert (NDMA / IMD / KSDMA) */}
            {topAlert ? (
              <article
                className={`relative border-l-4 p-6 ${
                  topAlert.severity === "critical"
                    ? "bg-critical/10 border-critical"
                    : topAlert.severity === "warn"
                      ? "bg-warn/10 border-warn"
                      : "bg-primary/10 border-primary"
                }`}
              >
                <div className="flex justify-between items-start mb-4 gap-4 flex-wrap">
                  <span
                    className={`font-display px-3 py-1 text-xs font-bold uppercase tracking-widest ${
                      topAlert.severity === "critical"
                        ? "bg-critical text-critical-foreground"
                        : topAlert.severity === "warn"
                          ? "bg-warn text-background"
                          : "bg-primary text-background"
                    }`}
                  >
                    {topAlert.severityLabel} · {topAlert.source}
                  </span>
                  <span className="text-xs text-muted-foreground font-display">
                    {formatAlertWindow(topAlert.effectiveStart)}
                  </span>
                </div>
                <h2 className="font-display text-2xl md:text-3xl font-bold mb-3 leading-tight">
                  {topAlert.district ?? "Kerala"}: {topAlert.disasterType}
                </h2>
                <p className="text-base md:text-lg text-foreground/80 mb-4">
                  {topAlert.message || topAlert.areaDescription}
                </p>
                <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                  Area: {topAlert.areaDescription}
                </div>
              </article>
            ) : (
              <article className="relative bg-surface border-l-4 border-primary/40 p-6">
                <div className="font-display text-[10px] uppercase tracking-widest text-primary font-bold mb-2">
                  All Clear · Official Feed
                </div>
                <h2 className="font-display text-2xl md:text-3xl font-bold mb-3 leading-tight">
                  No active NDMA / IMD advisories for Kerala
                </h2>
                <p className="text-base text-foreground/70">
                  Community reports below are crowd-sourced. Official warnings will appear here the moment they are issued.
                </p>
              </article>
            )}


            {/* Location picker + Report action */}
            <div className="bg-surface p-6 space-y-5">
              <div>
                <label className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground mb-3 font-bold">
                  Step 1 · Choose Your Location
                </label>
                <LocationPicker selected={selectedPlace} onSelect={setSelectedPlace} />
              </div>

              <div className="grid grid-cols-1">
                <button
                  type="button"
                  disabled={!selectedPlace}
                  onClick={() => setReportOpen(true)}
                  className="flex flex-col items-start p-6 bg-background border border-warn/30 enabled:hover:border-warn transition-all text-left group disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-between w-full mb-4">
                    <div className="w-10 h-10 rounded-full bg-warn/20 flex items-center justify-center group-enabled:group-hover:scale-110 transition-transform">
                      <div className="w-4 h-4 bg-warn rotate-45" />
                    </div>
                    <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                      Step 2
                    </span>
                  </div>
                  <span className="font-display text-xl font-bold mb-1 uppercase tracking-tight">
                    Report Alert
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {selectedPlace
                      ? `Submit a report for ${selectedPlace.name}, ${selectedPlace.district}.`
                      : "Pick a location above to enable reporting."}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Right: Stats + Live Feed */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-surface p-6">
              <h3 className="font-display text-xs font-bold uppercase tracking-widest text-muted-foreground mb-6">
                Kerala Overview
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <Stat
                  value={String(alerts.filter((a) => a.severity !== "safe").length)}
                  label="Official Alerts"
                  tone="warn"
                />
                <Stat
                  value={String(reports.length)}
                  label="Crowd Reports"
                  tone="primary"
                />
                <Stat
                  value={String(
                    new Set([
                      ...alerts.map((a) => a.district).filter(Boolean),
                      ...reports.map((r) => r.district),
                    ]).size,
                  )}
                  label="Districts Active"
                  tone="warn"
                />
                <Stat
                  value={String(
                    new Set(
                      [
                        ...alerts.filter((a) => a.severity === "critical").map((a) => a.district),
                        ...reports.filter((r) => r.severity === "critical").map((r) => r.district),
                      ].filter(Boolean),
                    ).size,
                  )}
                  label="Critical Zones"
                  tone="muted"
                />
              </div>

            </div>

            <div className="bg-surface flex flex-col h-[400px]">
              <div className="p-4 border-b border-background/40 flex justify-between items-center gap-2">
                <h3 className="font-display text-xs font-bold uppercase tracking-widest">
                  Live Reports
                </h3>
                <div className="flex items-center gap-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>
                    {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      status === "live"
                        ? "bg-primary animate-pulse"
                        : status === "connecting"
                          ? "bg-warn animate-pulse"
                          : "bg-critical"
                    }`}
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {reports.length === 0 && status !== "connecting" && (
                  <div className="text-center py-8 text-muted-foreground/60 italic text-xs">
                    No recent reports
                  </div>
                )}
                {reports.slice(0, 20).map((r) => (
                  <FeedRow key={r.id} report={r} flash={flashId === r.id} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* District Grid */}
        <section className="space-y-4 pt-8 border-t border-surface">
          <h3 className="font-display text-xs font-bold uppercase tracking-widest text-muted-foreground">
            All Districts · Tap to inspect
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-surface border border-surface">
            {DISTRICTS.map((d) => {
              const dReports = reports.filter((r) => r.district === d.name);
              const dAlerts = alerts.filter((a) => a.district === d.name);
              const total = dReports.length + dAlerts.length;
              const sev: Severity = maxSeverity([
                ...dReports.map((r) => ({ severity: r.severity })),
                ...dAlerts.map((a) => ({ severity: a.severity })),
              ]);
              const load = total === 0 ? 0 : Math.min(1, total / 8);
              return (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setDistrictFocus(d.name)}
                  className="bg-background p-4 hover:bg-surface transition-colors text-left relative"
                >
                  <div className="font-display text-[10px] uppercase text-muted-foreground mb-2 font-bold flex justify-between">
                    <span>{d.code}</span>
                    {total > 0 && (
                      <span className={severityText(sev)}>{total}</span>
                    )}
                  </div>
                  <div className="font-display text-sm font-bold uppercase tracking-tight">
                    {d.name}
                  </div>
                  <div className="mt-4 h-1 w-full bg-foreground/5 rounded-full overflow-hidden">
                    {total > 0 && (
                      <div
                        className={`h-full ${severityColor(sev)} ${sev === "critical" ? "animate-pulse" : ""}`}
                        style={{ width: `${Math.max(8, load * 100)}%` }}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="pt-8 pb-4 text-center font-display text-[10px] uppercase tracking-widest text-muted-foreground/60">
          Community-powered + Official feeds (NDMA Sachet · IMD · KSDMA) · Built for Kerala
        </footer>
      </div>

      {reportOpen && selectedPlace && (
        <ReportAlertModal
          place={selectedPlace}
          onClose={() => setReportOpen(false)}
          onSubmitted={() => setReportOpen(false)}
        />
      )}

      {districtFocus && (
        <DistrictModal
          district={districtFocus}
          reports={reports.filter((r) => r.district === districtFocus)}
          alerts={alerts.filter((a) => a.district === districtFocus)}
          onClose={() => setDistrictFocus(null)}
        />
      )}

    </div>
  );
}

/* ---------------- Location Picker ---------------- */

function LocationPicker({
  selected,
  onSelect,
}: {
  selected: Place | null;
  onSelect: (p: Place | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const { results, loading } = usePhotonSearch(query);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function detectLocation() {
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const place = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setGeoLoading(false);
        if (!place) {
          setGeoError("Couldn't resolve your location.");
          return;
        }
        onSelect(place);
        setQuery(place.name);
      },
      (err) => {
        setGeoLoading(false);
        setGeoError(err.message || "Location permission denied.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div ref={boxRef} className="relative space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (selected) onSelect(null);
          }}
          placeholder="Search your place (e.g. Payyannur, Maniyara...)"
          className="flex-1 bg-background border border-surface focus:border-primary px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          onClick={detectLocation}
          disabled={geoLoading}
          className="font-display text-[10px] uppercase tracking-widest font-bold px-3 py-3 bg-background border border-primary/40 hover:border-primary text-primary disabled:opacity-50"
          title="Use my location"
        >
          {geoLoading ? "..." : "📍 Auto"}
        </button>
      </div>

      {selected && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/30 px-3 py-2">
          <div>
            <div className="font-display text-sm font-bold">{selected.name}</div>
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              {selected.district} District · {selected.context}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="font-display text-[10px] uppercase text-muted-foreground hover:text-foreground"
          >
            Clear ✕
          </button>
        </div>
      )}

      {geoError && (
        <div className="font-display text-[10px] uppercase tracking-widest text-critical">
          {geoError}
        </div>
      )}

      {open && !selected && (query.trim().length >= 2 || loading) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border border-surface max-h-72 overflow-y-auto shadow-xl">
          {loading && (
            <div className="px-3 py-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              Searching...
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              No places found in Kerala
            </div>
          )}
          {results.map((p, i) => (
            <button
              key={`${p.lat}-${p.lon}-${i}`}
              type="button"
              onClick={() => {
                onSelect(p);
                setQuery(p.name);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-surface border-b border-surface/60 last:border-0"
            >
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                {p.district} · {p.context}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Report Modal ---------------- */

function ReportAlertModal({
  place,
  onClose,
  onSubmitted,
}: {
  place: Place;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [severity, setSeverity] = useState<Severity>("warn");
  const [category, setCategory] = useState("Flood");
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickImage(f: File | null) {
    setImageFile(f);
    setImagePreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      setError("Message must be 1–500 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);

    let imagePath: string | null = null;
    if (imageFile) {
      if (imageFile.size > 5 * 1024 * 1024) {
        setSubmitting(false);
        setError("Image must be under 5 MB.");
        return;
      }
      const ext = imageFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;
      const path = `${place.district.toLowerCase()}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from("report-images")
        .upload(path, imageFile, { contentType: imageFile.type });
      if (upErr) {
        setSubmitting(false);
        setError(`Image upload failed: ${upErr.message}`);
        return;
      }
      imagePath = path;
    }

    const { error: insertError } = await supabase.from("reports").insert({
      district: place.district,
      place: place.name,
      lat: place.lat,
      lon: place.lon,
      message: trimmed,
      severity,
      category,
      image_url: imagePath,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onSubmitted();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-surface border border-warn/40 p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-[10px] uppercase tracking-widest text-warn font-bold mb-1">
              New Report
            </div>
            <h2 className="font-display text-xl font-bold uppercase tracking-tight">
              {place.name}
            </h2>
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {place.district} District · {place.context}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-display text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Close ✕
          </button>
        </div>

        <div className="grid grid-cols-1">
          <label className="space-y-2">
            <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              Category
            </span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-background border border-surface focus:border-primary px-3 py-2 text-sm outline-none"
            >
              {["Flood", "Landslide", "Road Damage", "Power", "Medical", "Fire", "Other"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Severity
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(["safe", "warn", "critical"] as Severity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`font-display text-xs uppercase tracking-widest font-bold py-2 border transition-colors ${
                  severity === s
                    ? s === "critical"
                      ? "border-critical bg-critical/20 text-critical"
                      : s === "warn"
                        ? "border-warn bg-warn/20 text-warn"
                        : "border-primary bg-primary/20 text-primary"
                    : "border-surface text-muted-foreground hover:border-foreground/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-2">
          <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            What happened?
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Brief description (what you saw, any risk, road blocked etc.)..."
            className="w-full bg-background border border-surface focus:border-primary px-3 py-2 text-sm outline-none resize-none placeholder:text-muted-foreground/60"
          />
          <div className="flex justify-between text-[10px] font-display uppercase tracking-widest text-muted-foreground">
            <span>{error ?? "Visible publicly on the live feed"}</span>
            <span>{message.length}/500</span>
          </div>
        </label>

        <div className="space-y-2">
          <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Photo (optional, max 5 MB)
          </span>
          {imagePreview ? (
            <div className="relative">
              <img src={imagePreview} alt="preview" className="w-full max-h-56 object-cover border border-surface" />
              <button
                type="button"
                onClick={() => pickImage(null)}
                className="absolute top-2 right-2 font-display text-[10px] uppercase tracking-widest font-bold px-2 py-1 bg-background/80 border border-surface hover:border-critical"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center w-full border border-dashed border-surface hover:border-primary py-6 cursor-pointer text-center">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              />
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
                + Attach photo
              </span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="font-display text-xs uppercase tracking-widest px-4 py-2 border border-surface hover:border-foreground/40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="font-display text-xs uppercase tracking-widest font-bold px-4 py-2 bg-warn text-background hover:bg-warn/90 disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- District Drill-down Modal ---------------- */

function DistrictModal({
  district,
  reports,
  onClose,
}: {
  district: string;
  reports: Report[];
  onClose: () => void;
}) {
  const places = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => r.place && set.add(r.place));
    return Array.from(set);
  }, [reports]);
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const visible = activePlace ? reports.filter((r) => r.place === activePlace) : reports;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-surface border border-primary/30 max-h-[90vh] flex flex-col"
      >
        <div className="p-5 border-b border-background/40 flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-[10px] uppercase tracking-widest text-primary font-bold mb-1">
              District Inspect
            </div>
            <h2 className="font-display text-xl font-bold uppercase tracking-tight">
              {district}
            </h2>
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {reports.length} live report{reports.length === 1 ? "" : "s"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-display text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Close ✕
          </button>
        </div>

        {places.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-5 py-3 border-b border-background/40">
            <button
              type="button"
              onClick={() => setActivePlace(null)}
              className={`shrink-0 font-display text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 border transition-colors ${
                activePlace === null
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-surface text-muted-foreground hover:border-foreground/40"
              }`}
            >
              All places
            </button>
            {places.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActivePlace(p)}
                className={`shrink-0 font-display text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 border transition-colors ${
                  activePlace === p
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-surface text-muted-foreground hover:border-foreground/40"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {visible.length === 0 && (
            <div className="text-center py-12 text-muted-foreground/60 italic text-xs font-display uppercase tracking-widest">
              No reports yet for {district}
            </div>
          )}
          {visible.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Cards ---------------- */

function FeedRow({ report, flash }: { report: Report; flash: boolean }) {
  const img = useSignedImage(report.image_url);
  return (
    <div
      className={`border-l-2 pl-3 py-1 transition-colors ${severityBorder(report.severity)} ${
        flash ? "bg-warn/10" : ""
      }`}
    >
      <div className="font-display text-xs text-muted-foreground mb-1 flex items-center gap-2">
        {flash && (
          <span className="font-display text-[9px] uppercase tracking-widest font-bold bg-warn text-background px-1.5 py-0.5">
            New
          </span>
        )}
        <span>
          {report.place ? `${report.place}, ` : ""}
          {report.district}
        </span>
        <span>· {formatReportTime(report.created_at)}</span>
      </div>
      <div className="text-sm font-semibold">{report.message}</div>
      {img && (
        <img
          src={img}
          alt=""
          className="mt-2 w-full max-h-32 object-cover border border-surface"
        />
      )}
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const img = useSignedImage(report.image_url);
  return (
    <article className={`bg-background border-l-4 ${severityBorder(report.severity)} p-4`}>
      <div className="flex justify-between items-start gap-3 mb-2">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
            {report.place ?? report.district} · {report.category ?? "General"}
          </div>
          <div className={`font-display text-[10px] uppercase tracking-widest font-bold ${severityText(report.severity)}`}>
            {report.severity}
          </div>
        </div>
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          {formatReportTime(report.created_at)}
        </span>
      </div>
      <p className="text-sm">{report.message}</p>
      {img && (
        <img src={img} alt="" className="mt-3 w-full max-h-64 object-cover border border-surface" />
      )}
    </article>
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
