import {
  getEntryStatus,
  getLagosWeekday,
  type AirtimeEntry,
  type AirtimeEntryInput,
  type Weekday,
} from '@/lib/airtime-api';

const weekdays: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function daysForSchedule(type: AirtimeEntry['type'], days: Weekday[]) {
  return type === 'Sponsored Program' && days.length > 0 ? new Set(days) : new Set(weekdays);
}

function hasMatchingWeekday(startDate: string, endDate: string, first: Set<Weekday>, second: Set<Weekday>) {
  const [year, month, day] = startDate.split('-').map(Number);
  for (let offset = 0; offset < 7; offset += 1) {
    const currentDate = new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
    if (currentDate > endDate) return false;
    const weekday = getLagosWeekday(new Date(`${currentDate}T12:00:00.000Z`));
    if (first.has(weekday) && second.has(weekday)) return true;
  }
  return false;
}

export function findScheduleClashes(
  input: AirtimeEntryInput,
  entries: AirtimeEntry[],
  today: string,
  ignoredEntryId?: string,
): AirtimeEntry[] {
  const newDays = daysForSchedule(input.type, input.daysOfWeek ?? []);
  const newTimes = new Set(input.timeSlots);

  return entries.filter(existing => {
    if (existing.id === ignoredEntryId) return false;
    const status = getEntryStatus(existing, today);
    if (status === 'expired') return false;

    const overlapStart = existing.startDate > input.startDate ? existing.startDate : input.startDate;
    const overlapEnd = existing.endDate < input.endDate ? existing.endDate : input.endDate;
    if (overlapStart > overlapEnd) return false;

    const existingDays = daysForSchedule(existing.type, existing.daysOfWeek);
    if (!hasMatchingWeekday(overlapStart, overlapEnd, existingDays, newDays)) return false;
    return existing.timeSlots.some(time => newTimes.has(time));
  });
}