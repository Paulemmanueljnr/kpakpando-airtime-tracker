import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEntry as apiCreateEntry,
  deleteEntry as apiDeleteEntry,
  getDashboardSummary as apiGetDashboardSummary,
  getListEntriesQueryKey,
  getGetDashboardSummaryQueryKey,
  listEntries as apiListEntries,
  setBaseUrl,
  updateEntry as apiUpdateEntry,
  type AirtimeEntry,
  type AirtimeEntryInput,
  type AirtimeType,
  type DashboardSummary,
  type PaymentStatus,
  type Weekday,
} from "@workspace/api-client-react";

export type {
  AirtimeEntry,
  AirtimeEntryInput,
  AirtimeType,
  DashboardSummary,
  PaymentStatus,
  Weekday,
};

const API_URL = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "") ?? "";
const DEMO_STORAGE_KEY = "kpakpando-airtime-tracker-demo-v1";

setBaseUrl(API_URL || null);
export const isDemoMode = !API_URL;

export type EntryStatus = "not-started" | "active" | "expiring-soon" | "expired";

function dateInLagos(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function getLagosToday(now = new Date()): string {
  return dateInLagos(now);
}

export function getLagosTime(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export function getLagosWeekday(now = new Date()): Weekday {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "long",
  }).format(now) as Weekday;
}

function dateOffset(days: number, today = dateInLagos()): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function dayDifference(later: string, earlier: string): number {
  const [laterYear, laterMonth, laterDay] = later.split("-").map(Number);
  const [earlierYear, earlierMonth, earlierDay] = earlier.split("-").map(Number);
  return Math.round(
    (Date.UTC(laterYear, laterMonth - 1, laterDay) -
      Date.UTC(earlierYear, earlierMonth - 1, earlierDay)) /
      86_400_000,
  );
}

export function getEntryStatus(
  entry: Pick<AirtimeEntry, "startDate" | "endDate">,
  today = dateInLagos(),
): EntryStatus {
  if (today < entry.startDate) return "not-started";
  const remaining = dayDifference(entry.endDate, today);
  if (remaining < 0) return "expired";
  if (remaining <= 7) return "expiring-soon";
  return "active";
}

export function getEntryCountdown(
  entry: Pick<AirtimeEntry, "startDate" | "endDate">,
  today = dateInLagos(),
): string {
  const status = getEntryStatus(entry, today);
  if (status === "not-started") {
    const days = dayDifference(entry.startDate, today);
    return `Starts in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (status === "expired") {
    const days = Math.abs(dayDifference(entry.endDate, today));
    return days === 1 ? "Expired yesterday" : `Expired ${days} days ago`;
  }
  const days = dayDifference(entry.endDate, today);
  return days === 0 ? "Ends today" : `${days} ${days === 1 ? "day" : "days"} left`;
}

function isScheduledToday(entry: AirtimeEntry, now = new Date()): boolean {
  const today = dateInLagos(now);
  if (today < entry.startDate || today > entry.endDate) return false;
  if (entry.type !== "Sponsored Program" || entry.daysOfWeek.length === 0) return true;
  return entry.daysOfWeek.includes(getLagosWeekday(now));
}

function makeDemoEntries(): AirtimeEntry[] {
  const today = dateInLagos();
  const createdAt = new Date().toISOString();
  const make = (
    id: string,
    type: AirtimeType,
    client: string,
    title: string,
    paymentStatus: PaymentStatus,
    startOffset: number,
    endOffset: number,
    timeSlots: string[],
    daysOfWeek: Weekday[] = [],
    notes: string | null = null,
  ): AirtimeEntry => ({
    id,
    type,
    client,
    title,
    paymentStatus,
    startDate: dateOffset(startOffset, today),
    endDate: dateOffset(endOffset, today),
    timeSlots,
    daysOfWeek,
    notes,
    createdAt,
  });

  return [
    make(
      "demo-jingle-1",
      "Jingle",
      "Sunrise Foods",
      "Good food, good mornings",
      "Paid",
      -18,
      23,
      ["06:30", "12:45", "19:50"],
      [],
      "30-second breakfast campaign",
    ),
    make(
      "demo-program-1",
      "Sponsored Program",
      "Unity Microfinance",
      "The Money Corner",
      "Unpaid",
      -21,
      5,
      ["07:30", "18:00"],
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "Finance and practical savings segment",
    ),
    make(
      "demo-jingle-2",
      "Jingle",
      "Forward Nigeria",
      "A stronger voice for every community",
      "Unpaid",
      2,
      32,
      ["08:15", "14:00"],
      [],
      "Political campaign spot",
    ),
    make(
      "demo-program-2",
      "Sponsored Program",
      "Green Harvest Co-op",
      "Farmers’ Hour",
      "Paid",
      -8,
      19,
      ["10:00"],
      ["Monday", "Wednesday", "Friday"],
      "Live studio discussion",
    ),
    make(
      "demo-jingle-expired",
      "Jingle",
      "Cedar Mobile",
      "Switch to Cedar",
      "Paid",
      -35,
      -2,
      ["09:00", "16:30"],
    ),
  ];
}

function readDemoEntries(): AirtimeEntry[] {
  const saved = window.localStorage.getItem(DEMO_STORAGE_KEY);
  if (saved === null) {
    const initial = makeDemoEntries();
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed)) {
    throw new Error("Saved demo entries are invalid. Clear this browser’s demo data to continue.");
  }
  return parsed as AirtimeEntry[];
}

function writeDemoEntries(entries: AirtimeEntry[]): AirtimeEntry[] {
  window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

function getDemoSummary(entries: AirtimeEntry[]): DashboardSummary {
  const today = dateInLagos();
  const visible = entries.filter((entry) => getEntryStatus(entry, today) !== "expired");
  return {
    active: visible.filter((entry) => getEntryStatus(entry, today) === "active").length,
    expiringSoon: visible.filter((entry) => getEntryStatus(entry, today) === "expiring-soon").length,
    unpaid: visible.filter((entry) => entry.paymentStatus === "Unpaid").length,
    airingToday: visible.filter((entry) => isScheduledToday(entry)).length,
  };
}

async function invalidateDashboard(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
  ]);
}

export function useListEntries() {
  return useQuery({
    queryKey: getListEntriesQueryKey(),
    queryFn: ({ signal }) => (API_URL ? apiListEntries({ signal }) : readDemoEntries()),
    staleTime: 30_000,
  });
}

export function useGetDashboardSummary() {
  const entries = useListEntries();
  return useQuery({
    queryKey: getGetDashboardSummaryQueryKey(),
    queryFn: () =>
      API_URL ? apiGetDashboardSummary() : getDemoSummary(entries.data ?? readDemoEntries()),
    enabled: API_URL ? true : entries.isSuccess,
    staleTime: 30_000,
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: AirtimeEntryInput }) => {
      if (API_URL) return apiCreateEntry(data);
      const entry: AirtimeEntry = {
        ...data,
        id: crypto.randomUUID(),
        daysOfWeek: data.daysOfWeek ?? [],
        notes: data.notes?.trim() || null,
        createdAt: new Date().toISOString(),
      };
      writeDemoEntries([entry, ...readDemoEntries()]);
      return entry;
    },
    onSuccess: () => invalidateDashboard(queryClient),
  });
}

export function useUpdateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AirtimeEntryInput }) => {
      if (API_URL) return apiUpdateEntry(id, data);
      const entries = readDemoEntries();
      const current = entries.find((entry) => entry.id === id);
      if (!current) throw new Error("This airtime entry no longer exists.");
      const updated: AirtimeEntry = {
        ...current,
        ...data,
        daysOfWeek: data.daysOfWeek ?? [],
        notes: data.notes?.trim() || null,
      };
      writeDemoEntries(entries.map((entry) => (entry.id === id ? updated : entry)));
      return updated;
    },
    onSuccess: () => invalidateDashboard(queryClient),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      if (API_URL) return apiDeleteEntry(id);
      const entries = readDemoEntries();
      if (!entries.some((entry) => entry.id === id)) {
        throw new Error("This airtime entry no longer exists.");
      }
      writeDemoEntries(entries.filter((entry) => entry.id !== id));
    },
    onSuccess: () => invalidateDashboard(queryClient),
  });
}