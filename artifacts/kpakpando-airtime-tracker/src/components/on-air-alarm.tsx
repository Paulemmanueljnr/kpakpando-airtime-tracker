import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, Clock3, Volume2, VolumeX } from 'lucide-react';
import {
  getEntryStatus,
  getLagosToday,
  getLagosWeekday,
  type AirtimeEntry,
} from '@/lib/airtime-api';

const ACKNOWLEDGED_STORAGE_KEY = 'kpakpando-on-air-alarm-acknowledged-v1';
const REMINDER_STORAGE_KEY = 'kpakpando-on-air-alarm-reminders-v1';
const REMINDER_WINDOW_MS = 5 * 60 * 1000;
const CATCH_UP_WINDOW_MS = 2 * 60 * 1000;

type ScheduledSlot = {
  key: string;
  date: string;
  time: string;
  timestamp: number;
  entry: AirtimeEntry;
};

function readStoredKeys(storageKey: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredKeys(storageKey: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // The in-memory alarm state still works when browser storage is unavailable.
  }
}

function makeSlotKey(entryId: string, date: string, time: string) {
  return `${entryId}|${date}|${time}`;
}

function lagosSlotTimestamp(date: string, time: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // Lagos remains UTC+1; interpreting the wall-clock slot as UTC-1 gives its UTC instant.
  return Date.UTC(year, month - 1, day, hour - 1, minute);
}

function addLagosDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function getAudioContext(audioRef: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  if (audioRef.current) return audioRef.current;
  const contextWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = window.AudioContext ?? contextWindow.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioRef.current = new AudioContextConstructor();
  return audioRef.current;
}

function playTone(context: AudioContext, frequency: number, start: number, duration: number, volume: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playSoftChime(context: AudioContext) {
  const start = context.currentTime + 0.015;
  [659.25, 880, 1174.66].forEach((frequency, index) => {
    playTone(context, frequency, start + index * 0.13, 0.33, 0.11);
  });
}

function playLoudAlarmBurst(context: AudioContext) {
  const start = context.currentTime + 0.015;
  [880, 660, 880].forEach((frequency, index) => {
    playTone(context, frequency, start + index * 0.29, 0.23, 0.42);
  });
}

function notify(title: string, body: string) {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
  try {
    new window.Notification(title, { body, tag: `kpakpando-${title}-${body}` });
  } catch {
    // Notifications can be unavailable in some browser contexts; the in-page banner remains.
  }
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
}

export function OnAirAlarm({ entries }: { entries: AirtimeEntry[] }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [audioMessage, setAudioMessage] = useState('');
  const [testPlaying, setTestPlaying] = useState(false);
  const acknowledgedRef = useRef(new Set(readStoredKeys(ACKNOWLEDGED_STORAGE_KEY)));
  const remindersRef = useRef(new Set(readStoredKeys(REMINDER_STORAGE_KEY)));
  const firedRef = useRef(new Set<string>());
  const activeRef = useRef<ScheduledSlot[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const testTimersRef = useRef<number[]>([]);
  const entriesRef = useRef(entries);
  const [activeAlarms, setActiveAlarms] = useState<ScheduledSlot[]>([]);
  const [comingUp, setComingUp] = useState<ScheduledSlot | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    function evaluate(allowCatchUp: boolean) {
      const now = new Date();
      const nowTimestamp = now.getTime();
      const today = getLagosToday(now);
      const weekday = getLagosWeekday(now);
      setNowMs(nowTimestamp);

      const todaySlots = entriesRef.current
        .filter(entry => {
          const status = getEntryStatus(entry, today);
          return (status === 'active' || status === 'expiring-soon')
            && entry.startDate <= today
            && entry.endDate >= today
            && (entry.type !== 'Sponsored Program' || entry.daysOfWeek.length === 0 || entry.daysOfWeek.includes(weekday));
        })
        .flatMap(entry => entry.timeSlots.map(time => ({
          key: makeSlotKey(entry.id, today, time),
          date: today,
          time,
          timestamp: lagosSlotTimestamp(today, time),
          entry,
        })))
        .sort((a, b) => a.timestamp - b.timestamp);

      const reminder = todaySlots.find(slot => {
        const remaining = slot.timestamp - nowTimestamp;
        return remaining > 0 && remaining <= REMINDER_WINDOW_MS && !acknowledgedRef.current.has(slot.key);
      }) ?? null;
      setComingUp(current => current?.key === reminder?.key ? current : reminder);

      if (reminder && !remindersRef.current.has(reminder.key)) {
        remindersRef.current.add(reminder.key);
        writeStoredKeys(REMINDER_STORAGE_KEY, remindersRef.current);
        const message = `${reminder.entry.title} (${reminder.entry.client}) at ${reminder.time}`;
        if (armedRef.current && !mutedRef.current && audioRef.current?.state === 'running') {
          playSoftChime(audioRef.current);
        }
        notify('Coming up in 5 min', message);
      }

      for (const slot of todaySlots) {
        if (acknowledgedRef.current.has(slot.key) || firedRef.current.has(slot.key)) continue;
        const difference = slot.timestamp - nowTimestamp;
        const onTime = Math.abs(difference) <= 1500;
        const missedWhileHidden = allowCatchUp && difference <= 0 && difference >= -CATCH_UP_WINDOW_MS;
        if (!onTime && !missedWhileHidden) continue;
        firedRef.current.add(slot.key);
        const nextActive = [...activeRef.current, slot];
        activeRef.current = nextActive;
        setActiveAlarms(nextActive);
        notify('TIME NOW', `${slot.entry.title} (${slot.entry.client}) - ${slot.time}`);
      }
    }

    evaluate(false);
    const timer = window.setInterval(() => evaluate(false), 1000);
    let pageWasHidden = document.visibilityState === 'hidden';
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pageWasHidden = true;
        return;
      }
      if (pageWasHidden) evaluate(true);
      pageWasHidden = false;
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!armed || muted || activeAlarms.length === 0) return;
    const context = audioRef.current;
    if (!context || context.state !== 'running') return;
    playLoudAlarmBurst(context);
    const timer = window.setInterval(() => playLoudAlarmBurst(context), 1200);
    return () => window.clearInterval(timer);
  }, [activeAlarms, armed, muted]);

  useEffect(() => () => {
    testTimersRef.current.forEach(timer => {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    });
    void audioRef.current?.close();
  }, []);

  const enableAlarm = async () => {
    if (armedRef.current) {
      armedRef.current = false;
      setArmed(false);
      setAudioMessage('Alarm disarmed. Visual alerts remain on.');
      return;
    }
    try {
      const context = getAudioContext(audioRef);
      if (!context) {
        setAudioMessage('Web Audio is not available in this browser.');
        return;
      }
      await context.resume();
      armedRef.current = true;
      setArmed(true);
      setAudioMessage('');
      if ('Notification' in window && window.Notification.permission === 'default') {
        void window.Notification.requestPermission();
      }
    } catch {
      setAudioMessage('Sound could not be enabled. Check your browser audio settings.');
    }
  };

  const toggleMute = () => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
  };

  const testAlarm = async () => {
    if (mutedRef.current) {
      setAudioMessage('Unmute the alarm to test its sound.');
      return;
    }
    try {
      const context = getAudioContext(audioRef);
      if (!context) {
        setAudioMessage('Web Audio is not available in this browser.');
        return;
      }
      await context.resume();
      testTimersRef.current.forEach(timer => {
        window.clearTimeout(timer);
        window.clearInterval(timer);
      });
      testTimersRef.current = [];
      setAudioMessage('');
      setTestPlaying(true);
      playSoftChime(context);
      const startAlarm = window.setTimeout(() => {
        playLoudAlarmBurst(context);
        const repeat = window.setInterval(() => playLoudAlarmBurst(context), 1200);
        const stopAlarm = window.setTimeout(() => {
          window.clearInterval(repeat);
          setTestPlaying(false);
        }, 3600);
        testTimersRef.current.push(repeat, stopAlarm);
      }, 1150);
      testTimersRef.current.push(startAlarm);
    } catch {
      setAudioMessage('The test sound could not play. Check your browser audio settings.');
      setTestPlaying(false);
    }
  };

  const acknowledge = (slot: ScheduledSlot) => {
    acknowledgedRef.current.add(slot.key);
    writeStoredKeys(ACKNOWLEDGED_STORAGE_KEY, acknowledgedRef.current);
    const nextActive = activeRef.current.filter(active => active.key !== slot.key);
    activeRef.current = nextActive;
    setActiveAlarms(nextActive);
  };

  const now = new Date(nowMs);
  const today = getLagosToday(now);
  const nextSlot = Array.from({ length: 8 }, (_, dayOffset) => {
    const date = addLagosDays(today, dayOffset);
    const dateWeekday = getLagosWeekday(new Date(lagosSlotTimestamp(date, '12:00')));
    return entries
    .filter(entry => {
      return entry.startDate <= date
        && entry.endDate >= date
        && (entry.type !== 'Sponsored Program' || entry.daysOfWeek.length === 0 || entry.daysOfWeek.includes(dateWeekday));
    })
    .flatMap(entry => entry.timeSlots.map(time => ({
      date,
      timestamp: lagosSlotTimestamp(date, time),
      time,
      entry,
    })))
    .filter(slot => slot.timestamp > nowMs);
  }).flat().sort((a, b) => a.timestamp - b.timestamp)[0];
  const nextSlotDay = nextSlot
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(nextSlot.timestamp))
    : '';

  return <section className="on-air-alarm" aria-label="On-air alarms">
    <div className="next-up-strip">
      <div className="next-up-copy">
        <div className="alarm-overline"><Clock3 size={13} /> NEXT UP · WAT</div>
        {nextSlot ? <>
          <div className="next-up-title">{nextSlot.entry.title} <span>({nextSlot.entry.client})</span></div>
          <div className="alarm-caption">Scheduled {nextSlot.date === today ? 'today' : nextSlotDay} at {nextSlot.time}</div>
        </> : <div className="next-up-title">No scheduled slots in the next 7 days</div>}
      </div>
      <div className="next-up-countdown" aria-label={nextSlot ? `Time until ${nextSlot.entry.title}` : 'No upcoming slot in the next 7 days'}>
        <span>{nextSlot ? formatCountdown(nextSlot.timestamp - nowMs) : '—:—:—'}</span>
        <small>COUNTDOWN</small>
      </div>
    </div>

    <div className="alarm-controls">
      <div className="alarm-readiness">
        <span className={`alarm-ready-dot ${armed ? 'armed' : ''}`} />
        <div><strong>{armed ? 'ALARM ARMED' : 'ALARM NOT ARMED'}</strong><small>{armed ? 'Sound enabled · WAT schedule' : 'Visual alerts are on; enable sound'}</small></div>
      </div>
      <div className="alarm-buttons">
        <button className={`alarm-enable-btn ${armed ? 'armed' : ''}`} type="button" onClick={() => void enableAlarm()} aria-pressed={armed}>
          {armed ? <BellRing size={15} /> : <Bell size={15} />}{armed ? 'Disable alarm' : 'Enable alarm'}
        </button>
        <button className={`alarm-utility-btn ${muted ? 'muted' : ''}`} type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute alarm' : 'Mute alarm'}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{muted ? 'Muted' : 'Mute'}
        </button>
        <button className="alarm-utility-btn" type="button" onClick={() => void testAlarm()} disabled={testPlaying} title={muted ? 'Unmute to test the alarm sound' : 'Play both alarm sounds'}>
          <BellRing size={15} />{testPlaying ? 'Testing…' : 'Test alarm'}
        </button>
      </div>
    </div>

    {audioMessage && <div className="alarm-message" role="status">{audioMessage}</div>}

    {comingUp && <div className="alarm-banner alarm-banner-upcoming" role="status">
      <Bell size={19} />
      <span>Coming up in 5 min: {comingUp.entry.title} ({comingUp.entry.client}) at {comingUp.time}</span>
    </div>}

    {activeAlarms.map(slot => <div className="alarm-banner alarm-banner-now" role="alert" key={slot.key}>
      <BellRing size={21} />
      <span>TIME NOW: {slot.entry.title} ({slot.entry.client}) - {slot.time}</span>
      <button type="button" className="alarm-acknowledge" onClick={() => acknowledge(slot)} aria-label={`Acknowledge ${slot.entry.title} at ${slot.time}`}>
        <Check size={16} /> Acknowledge
      </button>
    </div>)}
  </section>;
}