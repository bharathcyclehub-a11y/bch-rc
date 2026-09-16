import "server-only";

import { createHash, createSign } from "node:crypto";
import { unstable_cache } from "next/cache";
import {
  GA4_METRICS, isValidIntegrationRange, parseClarityReport, parseGa4Report,
  type ClarityReport, type Ga4Report, type IntegrationRange, type IntegrationResult,
} from "@/lib/analytics-integrations-adapters";

export type { ClarityReport, Ga4Report, IntegrationRange, IntegrationResult } from "@/lib/analytics-integrations-adapters";

const clean = (value: string | undefined) => (value ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
const fingerprint = (...values: string[]) => createHash("sha256").update(values.join("\0")).digest("hex");
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";
const REQUEST_TIMEOUT_MS = 12_000;

class ProviderError extends Error {
  constructor(readonly status: number) { super("Analytics provider request failed"); }
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new ProviderError(response.status);
  return response.json();
}

function failed<T>(provider: "GA4" | "Clarity", error: unknown, dashboardUrl: string | null): IntegrationResult<T> {
  // Never return raw provider responses/errors: they can echo credentials,
  // account details or internal requests into the rendered admin page.
  const status = error instanceof ProviderError ? error.status : 0;
  const message = status === 429
    ? `${provider}'s API quota is exhausted. The cached result will refresh automatically after the cache interval.`
    : status === 401 || status === 403
      ? `${provider} rejected access. Check the server credentials and reporting permissions.`
      : status === 400
        ? `${provider} rejected the report configuration. Check the property, hostname and date settings.`
        : `${provider} could not return a valid report. Check the connection and server configuration.`;
  return { status: "error", message, missing: [], dashboardUrl, fetchedAt: null, report: null };
}

function missing<T>(provider: string, keys: string[], dashboardUrl: string | null): IntegrationResult<T> {
  return {
    status: "not_configured", message: `${provider} tracking and reporting use separate credentials. Connect the reporting API to display its data here.`,
    missing: keys, dashboardUrl, fetchedAt: null, report: null,
  };
}

function scopeMismatch<T>(siteIds: string[]): IntegrationResult<T> | null {
  const configuredSite = clean(process.env.ANALYTICS_INTEGRATION_SITE_ID);
  // Allow a multi-site admin to view this clearly labeled single-site source,
  // but never expose a site's provider data to an admin without that site.
  if (siteIds.includes(configuredSite)) return null;
  return {
    status: "scope_mismatch", message: "This reporting connection belongs to a different storefront than your permitted site scope.",
    missing: [], dashboardUrl: null, fetchedAt: null, report: null,
  };
}

let tokenCache: { key: string; value: string; expiresAt: number } | undefined;

async function accessToken(email: string, privateKey: string): Promise<string> {
  const key = fingerprint(email, privateKey);
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: TOKEN_ENDPOINT, iat: now, exp: now + 3600,
  })).toString("base64url");
  const unsigned = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(unsigned).end().sign(privateKey).toString("base64url");
  const response = await requestJson(TOKEN_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  }) as { access_token?: unknown; expires_in?: unknown };
  if (typeof response.access_token !== "string" || !response.access_token) throw new Error("Invalid token response");
  const expiresIn = Number(response.expires_in);
  tokenCache = {
    key, value: response.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? Math.max(0, Math.min(expiresIn, 3600)) : 0) * 1000,
  };
  return tokenCache.value;
}

async function getGa4(range: IntegrationRange): Promise<IntegrationResult<Ga4Report>> {
  const propertyId = clean(process.env.GA4_PROPERTY_ID);
  const email = clean(process.env.GA4_CLIENT_EMAIL);
  const privateKey = clean(process.env.GA4_PRIVATE_KEY).replace(/\\n/g, "\n");
  const hostname = clean(process.env.GA4_HOSTNAME).toLowerCase();
  const siteId = clean(process.env.ANALYTICS_INTEGRATION_SITE_ID);
  const dashboardUrl = /^\d+$/.test(propertyId) ? `https://analytics.google.com/analytics/web/#/p${propertyId}/reports/intelligenthome` : "https://analytics.google.com/";
  const keys = [
    ["GA4_PROPERTY_ID", propertyId], ["GA4_CLIENT_EMAIL", email], ["GA4_PRIVATE_KEY", privateKey],
    ["GA4_HOSTNAME", hostname], ["ANALYTICS_INTEGRATION_SITE_ID", siteId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (keys.length) return missing("GA4", keys, dashboardUrl);
  const wrongScope = scopeMismatch<Ga4Report>(range.siteIds);
  if (wrongScope) return wrongScope;
  if (!/^\d+$/.test(propertyId) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) || !hostname.includes(".") || !isValidIntegrationRange(range)) {
    return failed("GA4", new ProviderError(400), dashboardUrl);
  }
  const key = fingerprint(propertyId, email, privateKey, hostname, siteId);
  return unstable_cache(async (): Promise<IntegrationResult<Ga4Report>> => {
    try {
      const token = await accessToken(email, privateKey);
      const rootHost = hostname.replace(/^www\./, "");
      const common = {
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }], currencyCode: "INR",
        dimensionFilter: { filter: { fieldName: "hostName", inListFilter: { values: [rootHost, `www.${rootHost}`], caseSensitive: false } } },
      };
      const report = (body: Record<string, unknown>) => requestJson(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...common, ...body }),
      });
      const [summary, channels] = await Promise.all([
        report({ metrics: GA4_METRICS.map((name) => ({ name })), limit: "1" }),
        report({ dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: ["sessions", "activeUsers", "ecommercePurchases"].map((name) => ({ name })), orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: "20" }),
      ]);
      const parsed = parseGa4Report(summary, channels, range);
      parsed.notes.push(`Source: storefront ${siteId}; hostnames ${rootHost} and www.${rootHost}.`);
      return { status: "connected", message: "GA4 report received for the selected dates.", missing: [], dashboardUrl, fetchedAt: new Date().toISOString(), report: parsed };
    } catch (error) { return failed("GA4", error, dashboardUrl); }
  }, ["admin-ga4-v1", key, range.startDate, range.endDate], { revalidate: 900 })();
}

/** Internal server-only fetch used by the scheduled archive. Never call from a client. */
export async function fetchClaritySnapshot(windowHours: 24 | 72): Promise<IntegrationResult<ClarityReport>> {
  const token = clean(process.env.CLARITY_EXPORT_API_TOKEN);
  const projectId = clean(process.env.NEXT_PUBLIC_CLARITY_ID);
  const siteId = clean(process.env.ANALYTICS_INTEGRATION_SITE_ID);
  const dashboardUrl = /^[a-z0-9]+$/i.test(projectId) ? `https://clarity.microsoft.com/projects/view/${projectId}/dashboard` : "https://clarity.microsoft.com/";
  const keys = [["CLARITY_EXPORT_API_TOKEN", token], ["NEXT_PUBLIC_CLARITY_ID", projectId], ["ANALYTICS_INTEGRATION_SITE_ID", siteId]]
    .filter(([, value]) => !value).map(([name]) => name);
  if (keys.length) return missing("Clarity", keys, dashboardUrl);
  try {
    // Capture before the request: the provider's rolling window is relative to
    // request time, not a selected calendar date or the time a cache is read.
    const fetchedAt = new Date().toISOString();
    const response = await requestJson(`${CLARITY_ENDPOINT}?numOfDays=${windowHours / 24}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const report = parseClarityReport(response, windowHours, fetchedAt);
    report.notes.push(`Source: Clarity project ${projectId}, mapped to storefront ${siteId}.`);
    return { status: "connected", message: `Clarity rolling ${windowHours}-hour snapshot received.`, missing: [], dashboardUrl, fetchedAt, report };
  } catch (error) { return failed("Clarity", error, dashboardUrl); }
}

async function getClarity(range: IntegrationRange): Promise<IntegrationResult<ClarityReport>> {
  const token = clean(process.env.CLARITY_EXPORT_API_TOKEN);
  const projectId = clean(process.env.NEXT_PUBLIC_CLARITY_ID);
  const siteId = clean(process.env.ANALYTICS_INTEGRATION_SITE_ID);
  if (!token || !projectId || !siteId) return fetchClaritySnapshot(72); // Returns setup state without fetching.
  const wrongScope = scopeMismatch<ClarityReport>(range.siteIds);
  if (wrongScope) return wrongScope;
  // Stable key deliberately excludes selected dates. Reopening a different
  // month must not spend another one of Clarity's ten daily API requests.
  // Cache errors too, so an invalid token/quota does not cause a request storm.
  return unstable_cache(() => fetchClaritySnapshot(72),
    ["admin-clarity-live-v1", fingerprint(token, projectId, siteId)], { revalidate: 21_600 })();
}

export async function getAnalyticsIntegrations(range: IntegrationRange): Promise<{
  ga4: IntegrationResult<Ga4Report>; clarity: IntegrationResult<ClarityReport>;
}> {
  // A failed provider or cache backend must not take down first-party sales.
  const [ga4, clarity] = await Promise.all([
    getGa4(range).catch((error) => failed<Ga4Report>("GA4", error, null)),
    getClarity(range).catch((error) => failed<ClarityReport>("Clarity", error, null)),
  ]);
  return { ga4, clarity };
}
