interface PushStatement {
  bind(...values: unknown[]): PushStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results?: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface PushEnv {
  DB: { prepare(query: string): PushStatement };
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}

interface VapidJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d: string;
}
interface SlotRow {
  title: string;
  client: string;
  time_slots: string;
  days_of_week: string;
}
interface AlertRow {
  slot_key: string;
  kind: string;
  title: string;
  body: string;
}

const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];
const MAX_DEVICES = 30;

function respond(cors: Headers, status: number, data?: unknown): Response {
  const headers = new Headers(cors);
  if (data === undefined) return new Response(null, { status, headers });
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function lagosParts(date: Date): { day: string; time: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
  };
}

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function readVapid(env: PushEnv): VapidJwk | null {
  if (!env.VAPID_PRIVATE_JWK) return null;
  try {
    const jwk = JSON.parse(env.VAPID_PRIVATE_JWK) as VapidJwk;
    return jwk.x && jwk.y && jwk.d ? jwk : null;
  } catch {
    return null;
  }
}

function vapidPublicKey(jwk: VapidJwk): string {
  const key = new Uint8Array(65);
  key[0] = 4;
  key.set(b64urlToBytes(jwk.x), 1);
  key.set(b64urlToBytes(jwk.y), 33);
  return b64url(key);
}

async function vapidAuthHeader(jwk: VapidJwk, audience: string, subject: string): Promise<string> {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64url(
    JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${vapidPublicKey(jwk)}`;
}

async function sendPushes(env: PushEnv, jwk: VapidJwk): Promise<void> {
  const subs = await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all<{ endpoint: string }>();
  const subject = env.VAPID_SUBJECT || "mailto:admin@example.com";
  const headersByAudience = new Map<string, string>();
  for (const { endpoint } of subs.results ?? []) {
    try {
      const audience = new URL(endpoint).origin;
      let authorization = headersByAudience.get(audience);
      if (!authorization) {
        authorization = await vapidAuthHeader(jwk, audience, subject);
        headersByAudience.set(audience, authorization);
      }
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: authorization, TTL: "300", Urgency: "high" },
      });
      if (result.status === 404 || result.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
      }
    } catch {
      // one failing phone must not stop the others
    }
  }
}

async function checkAlerts(env: PushEnv): Promise<void> {
  const jwk = readVapid(env);
  if (!jwk) return;
  const now = Date.now();
  const batch = new Date(now).toISOString().slice(0, 16);
  const groups: { kind: "pre" | "now"; offsets: number[] }[] = [
    { kind: "now", offsets: [0, -1] },
    { kind: "pre", offsets: [5, 4] },
  ];
  const cache = new Map<string, SlotRow[]>();
  let created = false;

  for (const group of groups) {
    for (const offset of group.offsets) {
      const p = lagosParts(new Date(now + offset * 60_000));
      let rows = cache.get(p.day);
      if (!rows) {
        const result = await env.DB.prepare(
          "SELECT title, client, time_slots, days_of_week FROM airtime_entries WHERE start_date <= ? AND end_date >= ?",
        )
          .bind(p.day, p.day)
          .all<SlotRow>();
        rows = result.results ?? [];
        cache.set(p.day, rows);
      }
      const due = rows.filter((row) => {
        const days = parseList(row.days_of_week);
        return parseList(row.time_slots).includes(p.time) && (days.length === 0 || days.includes(p.weekday));
      });
      if (due.length === 0) continue;

      const title = group.kind === "now" ? `TIME NOW - ${p.time}` : `Coming up in 5 min - ${p.time}`;
      const body = due.map((row) => `${row.title} (${row.client})`).join("\n");
      const insert = await env.DB.prepare(
        "INSERT OR IGNORE INTO push_alerts (slot_key, kind, title, body, batch, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(`${group.kind}:${p.day}:${p.time}`, group.kind, title, body, batch, new Date().toISOString())
        .run();
      if ((insert.meta?.changes ?? 0) > 0) created = true;
    }
  }
  if (created) await sendPushes(env, jwk);
}

export async function runScheduled(env: PushEnv): Promise<void> {
  try {
    await checkAlerts(env);
    if (lagosParts(new Date()).time === "03:00") {
      const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString();
      await env.DB.prepare("DELETE FROM push_alerts WHERE created_at < ?").bind(cutoff).run();
    }
  } catch {
    // never let a failed run break the Worker
  }
}

export async function handlePushRequest(
  request: Request,
  env: PushEnv,
  path: string,
  method: string,
  cors: Headers,
): Promise<Response | null> {
  if (path === "/api/push/key" && method === "GET") {
    const jwk = readVapid(env);
    return jwk
      ? respond(cors, 200, { publicKey: vapidPublicKey(jwk) })
      : respond(cors, 503, { error: "Push alerts are not configured." });
  }

  if (path === "/api/push/subscribe" && method === "POST") {
    const body = await readJson(request);
    const endpoint = body?.endpoint;
    const keys = body?.keys as { p256dh?: unknown; auth?: unknown } | undefined;
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;
    if (
      typeof endpoint !== "string" ||
      endpoint.length > 600 ||
      !isAllowedPushEndpoint(endpoint) ||
      typeof p256dh !== "string" ||
      p256dh.length > 200 ||
      typeof auth !== "string" ||
      auth.length > 100
    ) {
      return respond(cors, 400, { error: "Invalid subscription." });
    }
    const exists = await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?")
      .bind(endpoint)
      .first<{ endpoint: string }>();
    if (!exists) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_DEVICES) return respond(cors, 429, { error: "Too many devices registered." });
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    )
      .bind(endpoint, p256dh, auth, new Date().toISOString())
      .run();
    return respond(cors, 201, { ok: true });
  }

  if (path === "/api/push/unsubscribe" && method === "POST") {
    const body = await readJson(request);
    if (typeof body?.endpoint !== "string") return respond(cors, 400, { error: "Invalid request." });
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(body.endpoint).run();
    return respond(cors, 200, { ok: true });
  }

  if (path === "/api/push/latest" && method === "GET") {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const last = await env.DB.prepare(
      "SELECT batch FROM push_alerts WHERE created_at >= ? ORDER BY id DESC LIMIT 1",
    )
      .bind(since)
      .first<{ batch: string }>();
    if (!last) return respond(cors, 200, []);
    const rows = await env.DB.prepare(
      "SELECT slot_key, kind, title, body FROM push_alerts WHERE batch = ? ORDER BY id ASC",
    )
      .bind(last.batch)
      .all<AlertRow>();
    return respond(cors, 200, rows.results ?? []);
  }

  return null;
}