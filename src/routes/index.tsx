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
type District = { code: string; name: string; lat: number; lon: number };
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

type Place = { name: string; context: string; lat: number; lon: number; district: string };

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
  for (const it of items) if (SEVERITY_RANK[it.severity] > SEVERITY_RANK[best]) best = it.severity;
  return best;
}

/* ---------------- helpers ---------------- */

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
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
  return { name: p.name ?? "Unknown", context: context || "Kerala, India", lat, lon, district };
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
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${KERALA_CENTER.lat}&lon=${KERALA_CENTER.lon}&limit=8`;
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
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`);
    const data: { features: PhotonFeature[] } = await res.json();
    const f = data.features?.[0];
    if (!f) return null;
    return toPlace(f);
  } catch {
    return null;
  }
}

function useLiveReports(limit = 40) {
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
  return d.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

const severityDot = (s: Severity) =>
  s === "critical" ? "bg-critical" : s === "warn" ? "bg-warn" : "bg-emerald-600";

const severityText = (s: Severity) =>
  s === "critical" ? "text-critical" : s === "warn" ? "text-warn" : "text-emerald-700";

const severityBorder = (s: Severity) =>
  s === "critical" ? "border-critical" : s === "warn" ? "border-warn" : "border-ink/30";

function useLocalTime() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const ist = new Date(d.getTime() + (5.5 * 60 + d.getTimezoneOffset()) * 60000);
      setTime(
        `${ist.getHours().toString().padStart(2, "0")}:${ist.getMinutes().toString().padStart(2, "0")} IST`,
      );
    };
    fmt();
    const id = setInterval(fmt, 30000);
    return () => clearInterval(id);
  }, []);
  return time;
}

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

/* ============================================================
   Main page — Newsroom Bulletin layout
   ============================================================ */

type NavKey = "overview" | "districts" | "alerts" | "feed";

function Home() {
  const time = useLocalTime();
  const { reports, status, flashId } = useLiveReports(40);
  const { alerts, status: alertStatus } = useKeralaAlerts();
  const tickerItems = useMemo(() => (alerts.length === 0 ? [] : [...alerts, ...alerts]), [alerts]);
  const topAlert = alerts[0] ?? null;

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [districtFocus, setDistrictFocus] = useState<string | null>(null);
  const [nav, setNav] = useState<NavKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeDistrictCount = new Set(
    [...alerts.map((a) => a.district), ...reports.map((r) => r.district)].filter(Boolean) as string[],
  ).size;
  const criticalDistricts = new Set(
    [
      ...alerts.filter((a) => a.severity === "critical").map((a) => a.district),
      ...reports.filter((r) => r.severity === "critical").map((r) => r.district),
    ].filter(Boolean) as string[],
  ).size;
  const officialActive = alerts.filter((a) => a.severity !== "safe").length;

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 z-40 h-screen w-64 shrink-0 bg-surface border-r border-ink/15 flex flex-col transition-transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-6 py-6 border-b border-ink/15">
          <div className="font-display text-xl font-extrabold leading-none tracking-tight text-ink">
            Anything<br />Happened?
          </div>
          <p className="font-display text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mt-2">
            Kerala · Disaster Watch
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {(
            [
              { key: "overview", label: "Overview", target: "overview" },
              { key: "districts", label: "Districts", target: "districts" },
              { key: "alerts", label: "Official Alerts", target: "alerts" },
              { key: "feed", label: "Live Reports", target: "feed" },
            ] as { key: NavKey; label: string; target: string }[]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setNav(item.key);
                scrollToId(item.target);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                nav === item.key
                  ? "bg-ink text-background"
                  : "text-foreground/80 hover:bg-surface-2"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${nav === item.key ? "bg-background" : "bg-ink/40"}`}
              />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-ink/15 space-y-3">
          <div className="p-3 bg-background border border-ink/15">
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              Emergency
            </div>
            <div className="font-display text-2xl font-extrabold text-ink mt-0.5">1077</div>
            <div className="font-display text-[10px] text-muted-foreground mt-0.5">
              Kerala SDMA Helpline
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted-foreground font-bold">
            <span
              className={`w-2 h-2 rounded-full ${
                status === "live"
                  ? "bg-emerald-600 animate-pulse"
                  : status === "connecting"
                    ? "bg-warn animate-pulse"
                    : "bg-critical"
              }`}
            />
            {status === "live" ? "System Live" : status === "connecting" ? "Connecting" : "Offline"}
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-ink/40 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Sticky command bar */}
        <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-ink/15">
          <div className="px-4 md:px-8 py-3 flex items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              className="lg:hidden font-display text-xs uppercase tracking-widest font-bold px-3 py-2 border border-ink/20 hover:border-ink"
              aria-label="Open menu"
            >
              Menu
            </button>

            <div className="hidden md:flex flex-col">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                {selectedPlace ? "Reporting from" : "No location set"}
              </span>
              <span className="font-display text-sm font-bold text-ink truncate max-w-[200px]">
                {selectedPlace
                  ? `${selectedPlace.name}, ${selectedPlace.district}`
                  : "Pick a place to enable Report"}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <LocationPicker selected={selectedPlace} onSelect={setSelectedPlace} compact />
            </div>

            <div className="hidden md:flex flex-col items-end">
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Local
              </span>
              <span className="font-display text-sm font-bold tabular-nums">{time || "—"}</span>
            </div>

            <button
              type="button"
              disabled={!selectedPlace}
              onClick={() => setReportOpen(true)}
              className="shrink-0 font-display text-xs uppercase tracking-widest font-extrabold px-4 py-2.5 bg-ink text-background hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Report Alert
            </button>
          </div>

          {/* Ticker */}
          <div className="border-t border-ink/15 bg-surface overflow-hidden">
            {tickerItems.length === 0 ? (
              <div className="px-4 md:px-8 py-2 font-display text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                {alertStatus === "loading"
                  ? "Fetching official advisories from NDMA Sachet…"
                  : alertStatus === "error"
                    ? "Official advisory feed unavailable right now."
                    : "All clear · No active official advisories for Kerala"}
              </div>
            ) : (
              <div className="py-2 flex whitespace-nowrap gap-8 font-display text-[11px] uppercase tracking-wider font-bold animate-ticker w-max">
                {tickerItems.map((a, i) => (
                  <span key={`${a.id}-${i}`} className="flex items-center gap-2 px-2">
                    <span className={severityText(a.severity)}>●</span>
                    <span className="text-ink">{a.district ?? "Kerala"}:</span>
                    <span className="text-muted-foreground">
                      {a.disasterType} · {a.source}
                    </span>
                    <span className="text-ink/20 ml-4">|</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="px-4 md:px-8 py-6 md:py-8 space-y-10 max-w-[1400px] w-full">
          {/* Overview section */}
          <section id="overview" className="space-y-6 scroll-mt-32">
            {/* Critical Lede */}
            {topAlert ? (
              <article
                className={`relative border-l-[6px] ${severityBorder(topAlert.severity)} bg-surface p-6 md:p-8`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <span
                    className={`font-display text-[10px] uppercase tracking-[0.2em] font-extrabold px-2.5 py-1 ${
                      topAlert.severity === "critical"
                        ? "bg-critical text-critical-foreground"
                        : topAlert.severity === "warn"
                          ? "bg-warn text-ink"
                          : "bg-ink text-background"
                    }`}
                  >
                    {topAlert.severityLabel} · {topAlert.source}
                  </span>
                  <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                    Issued {formatAlertWindow(topAlert.effectiveStart)}
                  </span>
                </div>
                <h2 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight leading-[1.05] text-ink mb-3">
                  {topAlert.district ?? "Kerala"}: {topAlert.disasterType}
                </h2>
                <p className="text-base md:text-lg text-foreground/85 max-w-3xl leading-relaxed">
                  {topAlert.message || topAlert.areaDescription}
                </p>
                <div className="mt-5 font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                  Area · {topAlert.areaDescription}
                </div>
              </article>
            ) : (
              <article className="relative bg-surface border-l-[6px] border-emerald-600 p-6 md:p-8">
                <div className="font-display text-[10px] uppercase tracking-[0.2em] text-emerald-700 font-extrabold mb-3">
                  All Clear · Official Feed
                </div>
                <h2 className="font-display text-3xl md:text-4xl font-extrabold tracking-tight leading-[1.05] text-ink mb-3">
                  No active NDMA / IMD advisories for Kerala
                </h2>
                <p className="text-base md:text-lg text-foreground/80 max-w-3xl">
                  Community reports below are crowd-sourced. Official warnings will appear here the moment they are issued.
                </p>
              </article>
            )}

            {/* Stats bento */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ink/15 border border-ink/15">
              <StatTile value={officialActive} label="Official Alerts" hint="NDMA · IMD · KSDMA" />
              <StatTile value={reports.length} label="Crowd Reports" hint="Last 24 hours" />
              <StatTile value={activeDistrictCount} label="Active Districts" hint={`of ${DISTRICTS.length}`} />
              <StatTile
                value={criticalDistricts}
                label="Critical Zones"
                hint={criticalDistricts > 0 ? "Action advised" : "None right now"}
                tone={criticalDistricts > 0 ? "critical" : "neutral"}
              />
            </div>
          </section>

          {/* Districts */}
          <section id="districts" className="space-y-4 scroll-mt-32">
            <SectionHead title="District Status" hint={`${DISTRICTS.length} districts · tap to open dossier`} />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-px bg-ink/15 border border-ink/15">
              {DISTRICTS.map((d) => {
                const dReports = reports.filter((r) => r.district === d.name);
                const dAlerts = alerts.filter((a) => a.district === d.name);
                const total = dReports.length + dAlerts.length;
                const sev: Severity = maxSeverity([
                  ...dReports.map((r) => ({ severity: r.severity })),
                  ...dAlerts.map((a) => ({ severity: a.severity })),
                ]);
                const sevLabel = sev === "critical" ? "Critical" : sev === "warn" ? "Watch" : "Normal";
                return (
                  <button
                    key={d.code}
                    type="button"
                    onClick={() => setDistrictFocus(d.name)}
                    className="bg-background hover:bg-surface text-left p-4 transition-colors group relative"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                        {d.code}
                      </span>
                      <span className={`w-2 h-2 rounded-full ${severityDot(sev)} ${sev === "critical" ? "animate-pulse" : ""}`} />
                    </div>
                    <div className="font-display text-sm font-extrabold tracking-tight text-ink mt-3 truncate">
                      {d.name}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className={`font-display text-[10px] uppercase tracking-widest font-bold ${severityText(sev)}`}>
                        {sevLabel}
                      </span>
                      {total > 0 && (
                        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold tabular-nums">
                          {total} report{total === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Dual feed */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div id="alerts" className="space-y-4 scroll-mt-32">
              <SectionHead title="Official Bulletins" hint="NDMA · IMD · KSDMA" />
              {alerts.length === 0 ? (
                <div className="p-6 bg-surface text-sm text-muted-foreground italic">
                  {alertStatus === "loading"
                    ? "Loading official advisories…"
                    : "No official advisories are active for Kerala right now."}
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.slice(0, 6).map((a) => (
                    <OfficialAlertCard key={a.id} alert={a} />
                  ))}
                </div>
              )}
            </div>

            <div id="feed" className="space-y-4 scroll-mt-32">
              <SectionHead
                title="Live Community Feed"
                hint={
                  status === "live"
                    ? "Real-time · crowdsourced"
                    : status === "connecting"
                      ? "Connecting…"
                      : "Offline"
                }
                statusDot={
                  status === "live" ? "bg-emerald-600" : status === "connecting" ? "bg-warn" : "bg-critical"
                }
              />
              {reports.length === 0 ? (
                <div className="p-6 bg-surface text-sm text-muted-foreground italic">
                  No crowd reports yet. Be the first to report from your area.
                </div>
              ) : (
                <div className="bg-surface divide-y divide-ink/10 max-h-[640px] overflow-y-auto">
                  {reports.map((r) => (
                    <FeedRow key={r.id} report={r} flash={flashId === r.id} />
                  ))}
                </div>
              )}
            </div>
          </section>

          <footer className="pt-8 pb-6 border-t border-ink/15 font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Community-powered + Official feeds (NDMA Sachet · IMD · KSDMA) · Built for Kerala
          </footer>
        </div>
      </main>

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

/* ---------------- Small building blocks ---------------- */

function SectionHead({
  title,
  hint,
  statusDot,
}: {
  title: string;
  hint?: string;
  statusDot?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-ink/15 pb-2">
      <h3 className="font-display text-lg md:text-xl font-extrabold tracking-tight text-ink">
        {title}
      </h3>
      {hint && (
        <div className="flex items-center gap-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          {statusDot && <span className={`w-1.5 h-1.5 rounded-full ${statusDot} animate-pulse`} />}
          {hint}
        </div>
      )}
    </div>
  );
}

function StatTile({
  value,
  label,
  hint,
  tone = "neutral",
}: {
  value: number | string;
  label: string;
  hint?: string;
  tone?: "neutral" | "critical";
}) {
  return (
    <div className="bg-background p-5">
      <div
        className={`font-display text-4xl font-extrabold tabular-nums tracking-tight ${
          tone === "critical" ? "text-critical" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="font-display text-[10px] uppercase tracking-[0.18em] text-ink font-bold mt-1">
        {label}
      </div>
      {hint && (
        <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-medium mt-0.5">
          {hint}
        </div>
      )}
    </div>
  );
}

/* ---------------- Location Picker ---------------- */

function LocationPicker({
  selected,
  onSelect,
  compact = false,
}: {
  selected: Place | null;
  onSelect: (p: Place | null) => void;
  compact?: boolean;
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
      setGeoError("Geolocation not supported.");
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

  const showChip = selected && compact;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              if (selected) onSelect(null);
            }}
            placeholder={
              showChip
                ? `${selected!.name}, ${selected!.district}`
                : "Search a place in Kerala (e.g. Vythiri, Maniyara)…"
            }
            className="w-full bg-surface border border-ink/15 focus:border-ink px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/70"
          />
          {showChip && (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setQuery("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 font-display text-[10px] uppercase tracking-widest text-muted-foreground hover:text-ink"
            >
              Clear ✕
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={detectLocation}
          disabled={geoLoading}
          className="shrink-0 font-display text-[10px] uppercase tracking-widest font-bold px-3 py-2.5 bg-surface border border-ink/15 hover:border-ink text-ink disabled:opacity-50"
          title="Use my location"
        >
          {geoLoading ? "…" : "📍 Auto"}
        </button>
      </div>

      {!compact && selected && (
        <div className="mt-2 flex items-center justify-between bg-ink/5 border border-ink/15 px-3 py-2">
          <div>
            <div className="font-display text-sm font-bold text-ink">{selected.name}</div>
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              {selected.district} · {selected.context}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="font-display text-[10px] uppercase text-muted-foreground hover:text-ink"
          >
            Clear ✕
          </button>
        </div>
      )}

      {geoError && (
        <div className="mt-2 font-display text-[10px] uppercase tracking-widest text-critical">
          {geoError}
        </div>
      )}

      {open && !selected && (query.trim().length >= 2 || loading) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border border-ink/20 max-h-72 overflow-y-auto shadow-xl">
          {loading && (
            <div className="px-3 py-2 font-display text-[10px] uppercase tracking-widest text-muted-foreground">
              Searching…
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
              className="w-full text-left px-3 py-2 hover:bg-surface border-b border-ink/10 last:border-0"
            >
              <div className="text-sm font-semibold text-ink">{p.name}</div>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg bg-background border border-ink/30 p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink/15 pb-4">
          <div>
            <div className="font-display text-[10px] uppercase tracking-[0.2em] text-warn font-extrabold mb-1">
              New Crowd Report
            </div>
            <h2 className="font-display text-xl font-extrabold tracking-tight text-ink">
              {place.name}
            </h2>
            <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground mt-1 font-bold">
              {place.district} · {place.context}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-display text-xs uppercase tracking-widest text-muted-foreground hover:text-ink"
          >
            Close ✕
          </button>
        </div>

        <label className="block space-y-2">
          <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-surface border border-ink/15 focus:border-ink px-3 py-2 text-sm outline-none"
          >
            {["Flood", "Landslide", "Road Damage", "Power", "Medical", "Fire", "Other"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

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
                      ? "border-critical bg-critical text-critical-foreground"
                      : s === "warn"
                        ? "border-warn bg-warn text-ink"
                        : "border-emerald-600 bg-emerald-600 text-background"
                    : "border-ink/20 text-muted-foreground hover:border-ink"
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
            placeholder="Brief description (road blocked, water rising, power cut, etc.)…"
            className="w-full bg-surface border border-ink/15 focus:border-ink px-3 py-2 text-sm outline-none resize-none placeholder:text-muted-foreground/60"
          />
          <div className="flex justify-between text-[10px] font-display uppercase tracking-widest text-muted-foreground">
            <span className={error ? "text-critical" : ""}>
              {error ?? "Visible publicly on the live feed"}
            </span>
            <span>{message.length}/500</span>
          </div>
        </label>

        <div className="space-y-2">
          <span className="font-display block text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Photo (optional, max 5 MB)
          </span>
          {imagePreview ? (
            <div className="relative">
              <img
                src={imagePreview}
                alt="preview"
                className="w-full max-h-56 object-cover border border-ink/15"
              />
              <button
                type="button"
                onClick={() => pickImage(null)}
                className="absolute top-2 right-2 font-display text-[10px] uppercase tracking-widest font-bold px-2 py-1 bg-background/90 border border-ink/20 hover:border-critical"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center w-full border border-dashed border-ink/25 hover:border-ink py-6 cursor-pointer text-center bg-surface">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              />
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                + Attach photo
              </span>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-ink/15">
          <button
            type="button"
            onClick={onClose}
            className="font-display text-xs uppercase tracking-widest font-bold px-4 py-2 border border-ink/20 hover:border-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="font-display text-xs uppercase tracking-widest font-extrabold px-4 py-2 bg-ink text-background hover:bg-ink/85 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Report"}
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
  alerts,
  onClose,
}: {
  district: string;
  reports: Report[];
  alerts: OfficialAlert[];
  onClose: () => void;
}) {
  const places = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => r.place && set.add(r.place));
    return Array.from(set);
  }, [reports]);
  const [activePlace, setActivePlace] = useState<string | null>(null);
  const visibleReports = activePlace ? reports.filter((r) => r.place === activePlace) : reports;

  const sev = maxSeverity([
    ...reports.map((r) => ({ severity: r.severity })),
    ...alerts.map((a) => ({ severity: a.severity })),
  ]);
  const sevLabel = sev === "critical" ? "Critical" : sev === "warn" ? "Watch" : "Normal";
  const headline =
    alerts.find((a) => a.severity === "critical")?.disasterType ??
    alerts[0]?.disasterType ??
    (reports.length > 0 ? "Crowd reports active" : "No active incidents");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-5xl bg-background border border-ink/25 max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Masthead */}
        <header className={`relative border-b-[6px] ${severityBorder(sev)} bg-surface p-6 md:p-8`}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="font-display text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-bold">
              Dossier · Kerala Disaster Watch
            </div>
            <button
              type="button"
              onClick={onClose}
              className="font-display text-xs uppercase tracking-widest text-muted-foreground hover:text-ink"
            >
              Close ✕
            </button>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${severityDot(sev)} ${sev === "critical" ? "animate-pulse" : ""}`} />
                <span className={`font-display text-[10px] uppercase tracking-[0.2em] font-extrabold ${severityText(sev)}`}>
                  {sevLabel}
                </span>
              </div>
              <h2 className="font-display text-3xl md:text-5xl font-extrabold uppercase tracking-tight leading-none text-ink">
                {district}
              </h2>
              <div className="font-display text-sm md:text-base text-foreground/80 mt-2">
                {headline}
              </div>
            </div>
            <div className="flex gap-6">
              <DossierMetric value={alerts.length} label="Official" tone={sev} />
              <DossierMetric value={reports.length} label="Crowd" tone="primary" />
              <DossierMetric value={places.length} label="Places" tone="muted" />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Official */}
          <section className="border-b border-ink/15">
            <div className="px-6 md:px-8 pt-5 pb-3 flex items-center justify-between">
              <h3 className="font-display text-sm md:text-base font-extrabold tracking-tight text-ink">
                Official Advisories
              </h3>
              <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                NDMA Sachet · IMD · KSDMA
              </span>
            </div>
            {alerts.length === 0 ? (
              <div className="px-6 md:px-8 pb-6 text-sm text-muted-foreground italic">
                No official advisories are active for {district} right now.
              </div>
            ) : (
              <div className="px-6 md:px-8 pb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                {alerts.map((a) => (
                  <OfficialAlertCard key={a.id} alert={a} />
                ))}
              </div>
            )}
          </section>

          {/* Crowd */}
          <section>
            <div className="px-6 md:px-8 pt-5 pb-3 flex items-center justify-between">
              <h3 className="font-display text-sm md:text-base font-extrabold tracking-tight text-ink">
                Crowd Briefs ({visibleReports.length})
              </h3>
            </div>

            {places.length > 0 && (
              <div className="flex gap-2 overflow-x-auto px-6 md:px-8 pb-3">
                <FilterChip
                  active={activePlace === null}
                  onClick={() => setActivePlace(null)}
                  label="All places"
                />
                {places.map((p) => (
                  <FilterChip
                    key={p}
                    active={activePlace === p}
                    onClick={() => setActivePlace(p)}
                    label={p}
                  />
                ))}
              </div>
            )}

            <div className="px-6 md:px-8 pb-8 space-y-3">
              {visibleReports.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground/70 italic text-xs font-display uppercase tracking-widest">
                  No crowd reports yet{activePlace ? ` for ${activePlace}` : ""}.
                </div>
              ) : (
                visibleReports.map((r) => <ReportCard key={r.id} report={r} />)
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 font-display text-[10px] uppercase tracking-widest font-bold px-3 py-1.5 border transition-colors ${
        active
          ? "border-ink bg-ink text-background"
          : "border-ink/20 text-muted-foreground hover:border-ink"
      }`}
    >
      {label}
    </button>
  );
}

function DossierMetric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: Severity | "primary" | "muted";
}) {
  const color =
    tone === "critical"
      ? "text-critical"
      : tone === "warn"
        ? "text-warn"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-ink";
  return (
    <div className="text-right">
      <div className={`font-display text-3xl md:text-4xl font-extrabold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        {label}
      </div>
    </div>
  );
}

function OfficialAlertCard({ alert }: { alert: OfficialAlert }) {
  return (
    <article className={`bg-background border-l-4 ${severityBorder(alert.severity)} border border-ink/15 p-4 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={`font-display text-[10px] uppercase tracking-widest font-extrabold ${severityText(alert.severity)}`}
          >
            {alert.severityLabel} · {alert.disasterType}
          </div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5 font-bold">
            {alert.source}
          </div>
        </div>
        <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground text-right shrink-0">
          {formatAlertWindow(alert.effectiveStart)}
          {alert.effectiveEnd ? ` → ${formatAlertWindow(alert.effectiveEnd)}` : ""}
        </div>
      </div>
      {alert.message && <p className="text-sm text-foreground/90 leading-relaxed">{alert.message}</p>}
      <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground/80">
        Area · {alert.areaDescription}
      </div>
    </article>
  );
}

/* ---------------- Cards ---------------- */

function FeedRow({ report, flash }: { report: Report; flash: boolean }) {
  const img = useSignedImage(report.image_url);
  return (
    <div
      className={`px-4 py-3 transition-colors ${flash ? "animate-flash" : ""} border-l-4 ${severityBorder(report.severity)}`}
    >
      <div className="flex items-center gap-2 mb-1 font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        {flash && (
          <span className="font-display text-[9px] uppercase tracking-widest font-extrabold bg-warn text-ink px-1.5 py-0.5">
            New
          </span>
        )}
        <span className="truncate">
          {report.place ? `${report.place}, ` : ""}
          {report.district}
        </span>
        <span className="text-ink/30">·</span>
        <span>{formatReportTime(report.created_at)}</span>
      </div>
      <div className="text-sm text-foreground leading-snug">{report.message}</div>
      {img && (
        <img src={img} alt="" className="mt-2 w-full max-h-40 object-cover border border-ink/15" />
      )}
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const img = useSignedImage(report.image_url);
  return (
    <article className={`bg-surface border-l-4 ${severityBorder(report.severity)} border border-ink/15 p-4`}>
      <div className="flex justify-between items-start gap-3 mb-2">
        <div>
          <div className="font-display text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            {report.place ?? report.district} · {report.category ?? "General"}
          </div>
          <div className={`font-display text-[10px] uppercase tracking-widest font-extrabold ${severityText(report.severity)}`}>
            {report.severity}
          </div>
        </div>
        <span className="font-display text-[10px] uppercase tracking-widest text-muted-foreground">
          {formatReportTime(report.created_at)}
        </span>
      </div>
      <p className="text-sm text-foreground leading-relaxed">{report.message}</p>
      {img && (
        <img src={img} alt="" className="mt-3 w-full max-h-64 object-cover border border-ink/15" />
      )}
    </article>
  );
}
