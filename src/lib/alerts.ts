import { createServerFn } from "@tanstack/react-start";

export type OfficialAlert = {
  id: string;
  source: string;
  disasterType: string;
  severity: "critical" | "warn" | "safe";
  severityLabel: string;
  areaDescription: string;
  message: string;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  district: string | null;
  centroid: { lat: number; lon: number } | null;
};

const KERALA_DISTRICTS = [
  "Thiruvananthapuram",
  "Trivandrum",
  "Kollam",
  "Pathanamthitta",
  "Alappuzha",
  "Kottayam",
  "Idukki",
  "Ernakulam",
  "Thrissur",
  "Palakkad",
  "Malappuram",
  "Kozhikode",
  "Calicut",
  "Wayanad",
  "Kannur",
  "Kasaragod",
];

const DISTRICT_CANONICAL: Record<string, string> = {
  thiruvananthapuram: "Trivandrum",
  trivandrum: "Trivandrum",
  kollam: "Kollam",
  pathanamthitta: "Pathanamthitta",
  alappuzha: "Alappuzha",
  alleppey: "Alappuzha",
  kottayam: "Kottayam",
  idukki: "Idukki",
  ernakulam: "Ernakulam",
  kochi: "Ernakulam",
  cochin: "Ernakulam",
  thrissur: "Thrissur",
  trichur: "Thrissur",
  palakkad: "Palakkad",
  palghat: "Palakkad",
  malappuram: "Malappuram",
  kozhikode: "Kozhikode",
  calicut: "Kozhikode",
  wayanad: "Wayanad",
  kannur: "Kannur",
  cannanore: "Kannur",
  kasaragod: "Kasaragod",
};

function mapSeverity(color?: string, label?: string): {
  severity: "critical" | "warn" | "safe";
  severityLabel: string;
} {
  const c = (color ?? "").toLowerCase();
  const l = label ?? "Advisory";
  if (c === "red") return { severity: "critical", severityLabel: l };
  if (c === "orange") return { severity: "warn", severityLabel: l };
  if (c === "yellow") return { severity: "warn", severityLabel: l };
  return { severity: "safe", severityLabel: l };
}

function inKerala(centroid?: string): { in: boolean; lat?: number; lon?: number } {
  if (!centroid) return { in: false };
  const [lonStr, latStr] = centroid.split(",");
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { in: false };
  // Kerala bounding box (approx)
  const insideBox = lat >= 8 && lat <= 13 && lon >= 74.5 && lon <= 77.6;
  return { in: insideBox, lat, lon };
}

function detectDistrict(text: string): string | null {
  const t = text.toLowerCase();
  for (const key of Object.keys(DISTRICT_CANONICAL)) {
    if (t.includes(key)) return DISTRICT_CANONICAL[key];
  }
  return null;
}

type RawAlert = {
  identifier: number | string;
  alert_source?: string;
  disaster_type?: string;
  severity_level?: string;
  severity_color?: string;
  area_description?: string;
  warning_message?: string;
  effective_start_time?: string;
  effective_end_time?: string;
  centroid?: string;
  actual_lang?: string;
};

export const getKeralaAlerts = createServerFn({ method: "GET" }).handler(
  async (): Promise<OfficialAlert[]> => {
    try {
      const res = await fetch(
        "https://sachet.ndma.gov.in/cap_public_website/FetchAllAlertDetails",
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "LiveDisaster-Kerala/1.0",
          },
        },
      );
      if (!res.ok) {
        console.error("[sachet] non-ok", res.status);
        return [];
      }
      const raw: RawAlert[] = await res.json();
      const kerala: OfficialAlert[] = [];
      for (const a of raw) {
        if ((a.actual_lang ?? "en") !== "en") continue;
        const area = a.area_description ?? "";
        const source = a.alert_source ?? "";
        const centroid = inKerala(a.centroid);
        const districtFromArea = detectDistrict(`${area} ${source}`);
        const sourceMentionsKerala = /kerala|ksdma|thiruvananthapuram|kochi|imd.*tvm|imd thiruvananthapuram/i.test(
          source,
        );
        const isKerala = !!districtFromArea || centroid.in || sourceMentionsKerala;
        if (!isKerala) continue;

        const sev = mapSeverity(a.severity_color, a.severity_level);
        kerala.push({
          id: String(a.identifier),
          source: source || "NDMA Sachet",
          disasterType: a.disaster_type ?? "Alert",
          severity: sev.severity,
          severityLabel: sev.severityLabel,
          areaDescription: area || "Kerala",
          message: a.warning_message ?? "",
          effectiveStart: a.effective_start_time ?? null,
          effectiveEnd: a.effective_end_time ?? null,
          district:
            districtFromArea ??
            (centroid.in && centroid.lat != null && centroid.lon != null
              ? nearestDistrict(centroid.lat, centroid.lon)
              : null),
          centroid:
            centroid.lat != null && centroid.lon != null
              ? { lat: centroid.lat, lon: centroid.lon }
              : null,
        });
      }
      // newest first by start time
      kerala.sort((a, b) => {
        const at = a.effectiveStart ? Date.parse(a.effectiveStart) : 0;
        const bt = b.effectiveStart ? Date.parse(b.effectiveStart) : 0;
        return bt - at;
      });
      return kerala.slice(0, 80);
    } catch (err) {
      console.error("[sachet] fetch failed", err);
      return [];
    }
  },
);

const DISTRICT_COORDS: Array<{ name: string; lat: number; lon: number }> = [
  { name: "Trivandrum", lat: 8.5241, lon: 76.9366 },
  { name: "Kollam", lat: 8.8932, lon: 76.6141 },
  { name: "Pathanamthitta", lat: 9.2648, lon: 76.787 },
  { name: "Alappuzha", lat: 9.4981, lon: 76.3388 },
  { name: "Kottayam", lat: 9.5916, lon: 76.5222 },
  { name: "Idukki", lat: 9.85, lon: 76.97 },
  { name: "Ernakulam", lat: 9.9816, lon: 76.2999 },
  { name: "Thrissur", lat: 10.5276, lon: 76.2144 },
  { name: "Palakkad", lat: 10.7867, lon: 76.6548 },
  { name: "Malappuram", lat: 11.041, lon: 76.0788 },
  { name: "Kozhikode", lat: 11.2588, lon: 75.7804 },
  { name: "Wayanad", lat: 11.6854, lon: 76.132 },
  { name: "Kannur", lat: 11.8745, lon: 75.3704 },
  { name: "Kasaragod", lat: 12.4996, lon: 74.9869 },
];

function nearestDistrict(lat: number, lon: number): string {
  let best = DISTRICT_COORDS[0];
  let bestDist = Infinity;
  for (const d of DISTRICT_COORDS) {
    const dLat = ((d.lat - lat) * Math.PI) / 180;
    const dLon = ((d.lon - lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat * Math.PI) / 180) *
        Math.cos((d.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const dist = 2 * 6371 * Math.asin(Math.sqrt(a));
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best.name;
}

export { KERALA_DISTRICTS };
