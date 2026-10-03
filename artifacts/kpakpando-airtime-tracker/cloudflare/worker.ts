type AirtimeType = "Jingle" | "Sponsored Program";
type PaymentStatus = "Paid" | "Unpaid";
type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

interface AirtimeEntry {
  id: string;
  type: AirtimeType;
  client: string;
  title: string;
  paymentStatus: PaymentStatus;
  startDate: string;
  endDate: string;
  timeSlots: string[];
  daysOfWeek: Weekday[];
  notes: string | null;
  createdAt: string;
}

interface AirtimeEntryInput {
  type: AirtimeType;
  client: string;
  title: string;
  paymentStatus: PaymentStatus;
  startDate: string;
  endDate: string;
  timeSlots: string[];
  daysOfWeek?: Weekday[];
  notes?: string;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS?: string;
}

interface EntryRow {
  id: string;
  type: AirtimeType;
  client: string;
  title: string;
  payment_status: PaymentStatus;
  start_date: string;
  end_date: string;
  time_slots: string;
  days_of_week: string;
  notes: string | null;
  created_at: string;
}

const WEEKDAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function getCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function response(
  body: BodyInit | null,
  status: number,
  cors: Headers,
  contentType?: string,
): Response {
  const headers = new Headers(cors);
  if (contentType) headers.set("Content-Type", contentType);
  return new Response(body, { status, headers });
}

function json(data: unknown, status: number, cors: Headers): Response {
  return response(JSON.stringify(data), status, cors, "application/json; charset=utf-8");
}

function error(message: string, status: number, cors: Headers): Response {
  return json({ error: message }, status, cors);
}

function lagosDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function lagosWeekday(now = new Date()): Weekday {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "long",
  }).format(now) as Weekday;
}

function entryStatus(entry: AirtimeEntry, today: string): "not-started" | "active" | "expiring-soon" | "expired" {
  if (today < entry.startDate) return "not-started";
  if (entry.endDate < today) return "expired";
  const [endYear, endMonth, endDay] = entry.endDate.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const daysRemaining = Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) /
      86_400_000,
  );
  return daysRemaining <= 7 ? "expiring-soon" : "active";
}

function toEntry(row: EntryRow): AirtimeEntry {
  return {
    id: row.id,
    type: row.type,
    client: row.client,
    title: row.title,
    paymentStatus: row.payment_status,
    startDate: row.start_date,
    endDate: row.end_date,
    timeSlots: JSON.parse(row.time_slots) as string[],
    daysOfWeek: JSON.parse(row.days_of_week) as Weekday[],
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function allEntries(db: D1Database): Promise<AirtimeEntry[]> {
  const result = await db
    .prepare("SELECT * FROM airtime_entries ORDER BY start_date ASC, created_at DESC")
    .all<EntryRow>();
  return (result.results ?? []).map(toEntry);
}

function parseEntryInput(value: unknown): AirtimeEntryInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isRealDate = (date: unknown): date is string =>
    typeof date === "string" &&
    datePattern.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) &&
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;

  if (input.type !== "Jingle" && input.type !== "Sponsored Program") return null;
  if (input.paymentStatus !== "Paid" && input.paymentStatus !== "Unpaid") return null;
  if (typeof input.client !== "string" || !input.client.trim()) return null;
  if (typeof input.title !== "string" || !input.title.trim()) return null;
  if (!isRealDate(input.startDate) || !isRealDate(input.endDate)) return null;
  if (input.startDate > input.endDate) return null;
  if (
    !Array.isArray(input.timeSlots) ||
    input.timeSlots.length === 0 ||
    input.timeSlots.some(
      (slot) => typeof slot !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot),
    )
  ) {
    return null;
  }

  const daysOfWeek = input.daysOfWeek ?? [];
  if (
    !Array.isArray(daysOfWeek) ||
    daysOfWeek.some((day) => typeof day !== "string" || !WEEKDAYS.includes(day as Weekday))
  ) {
    return null;
  }
  if (input.notes !== undefined && typeof input.notes !== "string") return null;

  return {
    type: input.type,
    client: input.client.trim(),
    title: input.title.trim(),
    paymentStatus: input.paymentStatus,
    startDate: input.startDate,
    endDate: input.endDate,
    timeSlots: [...new Set(input.timeSlots as string[])].sort(),
    daysOfWeek: [...new Set(daysOfWeek as Weekday[])],
    notes: typeof input.notes === "string" ? input.notes.trim() : undefined,
  };
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const cors = getCorsHeaders(request, env);
  const origin = request.headers.get("Origin");
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && !allowedOrigins.includes(origin)) {
    return error("This origin is not allowed.", 403, cors);
  }
  if (request.method === "OPTIONS") return response(null, 204, cors);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/api/healthz" && method === "GET") {
    return json({ status: "ok" }, 200, cors);
  }
  if (path === "/api/entries" && method === "GET") {
    return json(await allEntries(env.DB), 200, cors);
  }
  if (path === "/api/dashboard/summary" && method === "GET") {
    const today = lagosDate();
    const weekday = lagosWeekday();
    const entries = await allEntries(env.DB);
    const visible = entries.filter((entry) => entryStatus(entry, today) !== "expired");
    const airingToday = visible.filter(
      (entry) =>
        today >= entry.startDate &&
        today <= entry.endDate &&
        (entry.type !== "Sponsored Program" ||
          entry.daysOfWeek.length === 0 ||
          entry.daysOfWeek.includes(weekday)),
    );
    return json(
      {
        active: visible.filter((entry) => entryStatus(entry, today) === "active").length,
        expiringSoon: visible.filter((entry) => entryStatus(entry, today) === "expiring-soon").length,
        unpaid: visible.filter((entry) => entry.paymentStatus === "Unpaid").length,
        airingToday: airingToday.length,
      },
      200,
      cors,
    );
  }

  const match = path.match(/^\/api\/entries\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM airtime_entries WHERE id = ?")
        .bind(id)
        .first<EntryRow>();
      return row ? json(toEntry(row), 200, cors) : error("Entry not found.", 404, cors);
    }
    if (method === "PUT") {
      const current = await env.DB.prepare("SELECT id FROM airtime_entries WHERE id = ?")
        .bind(id)
        .first<{ id: string }>();
      if (!current) return error("Entry not found.", 404, cors);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return error("Request body must be valid JSON.", 400, cors);
      }
      const input = parseEntryInput(body);
      if (!input) return error("Entry fields are missing or invalid.", 400, cors);
      await env.DB.prepare(
        `UPDATE airtime_entries
         SET type = ?, client = ?, title = ?, payment_status = ?, start_date = ?, end_date = ?,
             time_slots = ?, days_of_week = ?, notes = ?
         WHERE id = ?`,
      )
        .bind(
          input.type,
          input.client,
          input.title,
          input.paymentStatus,
          input.startDate,
          input.endDate,
          JSON.stringify(input.timeSlots),
          JSON.stringify(input.daysOfWeek),
          input.notes ?? null,
          id,
        )
        .run();
      const updated = await env.DB.prepare("SELECT * FROM airtime_entries WHERE id = ?")
        .bind(id)
        .first<EntryRow>();
      return updated ? json(toEntry(updated), 200, cors) : error("Entry not found.", 404, cors);
    }
    if (method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM airtime_entries WHERE id = ?").bind(id).run();
      if (!result.success) return error("Unable to delete entry.", 500, cors);
      return response(null, 204, cors);
    }
  }

  if (path === "/api/entries" && method === "POST") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error("Request body must be valid JSON.", 400, cors);
    }
    const input = parseEntryInput(body);
    if (!input) return error("Entry fields are missing or invalid.", 400, cors);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO airtime_entries
        (id, type, client, title, payment_status, start_date, end_date, time_slots, days_of_week, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.type,
        input.client,
        input.title,
        input.paymentStatus,
        input.startDate,
        input.endDate,
        JSON.stringify(input.timeSlots),
        JSON.stringify(input.daysOfWeek),
        input.notes ?? null,
        createdAt,
      )
      .run();
    const created = await env.DB.prepare("SELECT * FROM airtime_entries WHERE id = ?")
      .bind(id)
      .first<EntryRow>();
    if (!created) return error("Entry was created but could not be read back.", 500, cors);
    return json(toEntry(created), 201, cors);
  }

  if (
    (path === "/api/entries" || match) &&
    !["GET", "POST", "PUT", "DELETE", "OPTIONS"].includes(method)
  ) {
    return error("Method not allowed.", 405, cors);
  }
  return error("Not found.", 404, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch {
      const cors = getCorsHeaders(request, env);
      return error("The request could not be completed.", 500, cors);
    }
  },
};