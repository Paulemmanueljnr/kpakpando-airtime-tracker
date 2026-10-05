import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, Clock3, Volume2, VolumeX } from 'lucide-react';
import { PhonePushAlerts } from '@/components/phone-push-alerts';
import {
  getEntryStatus,
  getLagosToday,
  getLagosWeekday,
  type AirtimeEntry,
} from '@/lib/airtime-api';

const ACKNOWLEDGED_STORAGE_KEY = 'kpakpando-on-air-alarm-acknowledged-v1';
const REMINDER_STORAGE_KEY = 'kpakpando-on-air-alarm-reminders-v1';
const ALARM_ENABLED_STORAGE_KEY = 'kpakpando-on-air-alarm-enabled-v1';
const ALARM_MUTED_STORAGE_KEY = 'kpakpando-on-air-alarm-muted-v1';
const KEEP_AWAKE_STORAGE_KEY = 'kpakpando-on-air-keep-awake-v1';
const REMINDER_WINDOW_MS = 5 * 60 * 1000;
const CATCH_UP_WINDOW_MS = 2 * 60 * 1000;

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

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

function readAlarmPreference() {
  try {
    return window.localStorage.getItem(ALARM_ENABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function readStoredBoolean(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function writeStoredBoolean(storageKey: string, value: boolean) {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Current-page settings still apply if browser storage is unavailable.
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

function notify(title: string, body: string, tag: string) {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
  try {
    const notification = new window.Notification(title, {
      body,
      tag: `kpakpando-${tag}`,
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
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
  const [isVisible, setIsVisible] = useState(() => document.visibilityState !== 'hidden');
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const [wantsAlarm, setWantsAlarm] = useState(() => readAlarmPreference());
  const wantsAlarmRef = useRef(wantsAlarm);
  const [resumeRequired, setResumeRequired] = useState(() => readAlarmPreference());
  const [audioRunning, setAudioRunning] = useState(false);
  const [muted, setMuted] = useState(() => readStoredBoolean(ALARM_MUTED_STORAGE_KEY));
  const mutedRef = useRef(muted);
  const [audioMessage, setAudioMessage] = useState('');
  const [wakeMessage, setWakeMessage] = useState('');
  const [keepAwake, setKeepAwake] = useState(() => readStoredBoolean(KEEP_AWAKE_STORAGE_KEY));
  const keepAwakeRef = useRef(keepAwake);
  const [testPlaying, setTestPlaying] = useState(false);
  const acknowledgedRef = useRef(new Set(readStoredKeys(ACKNOWLEDGED_STORAGE_KEY)));
  const remindersRef = useRef(new Set(readStoredKeys(REMINDER_STORAGE_KEY)));
  const firedRef = useRef(new Set<string>());
  const activeRef = useRef<ScheduledSlot[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const audioListenerRef = useRef(false);
  const silentOscillatorRef = useRef<OscillatorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const resumePendingRef = useRef(false);
  const resumeGestureAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const testTimersRef = useRef<number[]>([]);
  const entriesRef = useRef(entries);
  const [activeAlarms, setActiveAlarms] = useState<ScheduledSlot[]>([]);
  const [comingUp, setComingUp] = useState<ScheduledSlot | null>(null);
  const originalTitleRef = useRef<string | null>(null);
  const originalFaviconRef = useRef<string | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const ensureSilentSignal = (context: AudioContext) => {
    if (silentOscillatorRef.current) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    silentOscillatorRef.current = oscillator;
    silentGainRef.current = gain;
  };

  const startAlarmAudio = async (requestNotificationPermission: boolean) => {
    if (resumePendingRef.current) return;
    resumePendingRef.current = true;
    try {
      const context = getAudioContext(audioRef);
      if (!context) {
        setAudioMessage('Web Audio is not available in this browser.');
        return;
      }
      ensureSilentSignal(context);
      if (!audioListenerRef.current) {
        context.addEventListener('statechange', () => {
          const running = context.state === 'running';
          setAudioRunning(running);
          if (!running && wantsAlarmRef.current) {
            setResumeRequired(true);
            setAudioMessage('Audio was suspended. Click or tap anywhere on the page to resume the alarm.');
          } else if (running) {
            setResumeRequired(false);
            setAudioMessage('');
          }
        });
        audioListenerRef.current = true;
      }
            await Promise.race([
        context.resume(),
        new Promise<void>(resolve => window.setTimeout(resolve, 1500)),
      ]);
      if (context.state !== 'running') throw new Error('Audio did not resume.');
      armedRef.current = true;
      wantsAlarmRef.current = true;
      setArmed(true);
      setWantsAlarm(true);
      setResumeRequired(false);
      setAudioRunning(true);
      setAudioMessage('');
      try {
        window.localStorage.setItem(ALARM_ENABLED_STORAGE_KEY, 'true');
      } catch {
        // Audio remains enabled for this page even if browser storage is blocked.
      }
      if (requestNotificationPermission && 'Notification' in window && window.Notification.permission === 'default') {
        void window.Notification.requestPermission();
      }
    } catch {
      setAudioRunning(false);
      setAudioMessage('Sound could not be resumed. Click or tap again, or check your browser audio settings.');
    } finally {
      resumePendingRef.current = false;
    }
  };

  const requestWakeLock = async () => {
    if (!keepAwakeRef.current || wakeLockRef.current) return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) {
      setWakeMessage('Keep screen awake is not supported in this browser.');
      return;
    }
    try {
      const sentinel = await wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
      setWakeMessage('');
    } catch {
      setWakeMessage('The screen could not be kept awake. Keep this page open and visible.');
    }
  };

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
        notify('Coming up in 5 min', message, `reminder-${reminder.key}`);
      }

      for (const slot of todaySlots) {
        if (acknowledgedRef.current.has(slot.key) || firedRef.current.has(slot.key)) continue;
        const difference = slot.timestamp - nowTimestamp;
        const onTime = Math.abs(difference) <= 1500;
        const missed = allowCatchUp && difference <= 0 && difference >= -CATCH_UP_WINDOW_MS;
        if (!onTime && !missed) continue;
        firedRef.current.add(slot.key);
        const nextActive = [...activeRef.current, slot];
        activeRef.current = nextActive;
        setActiveAlarms(nextActive);
        notify('TIME NOW', `${slot.entry.title} (${slot.entry.client}) - ${slot.time}`, `air-${slot.key}`);
      }
    }

    evaluate(false);
    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    let fallbackTimer: number | null = null;
    try {
      if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && URL.createObjectURL) {
        workerUrl = URL.createObjectURL(new Blob(['setInterval(() => self.postMessage(Date.now()), 1000);'], { type: 'text/javascript' }));
        worker = new Worker(workerUrl);
        worker.addEventListener('message', () => evaluate(false));
      } else {
        fallbackTimer = window.setInterval(() => evaluate(false), 1000);
      }
    } catch {
      worker?.terminate();
      worker = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      workerUrl = null;
      fallbackTimer = window.setInterval(() => evaluate(false), 1000);
    }

    const handleVisibility = () => {
      evaluate(true);
      setIsVisible(document.visibilityState !== 'hidden');
      if (document.visibilityState === 'visible') {
        if (keepAwakeRef.current) void requestWakeLock();
        if (wantsAlarmRef.current && audioRef.current?.state !== 'running') void startAlarmAudio(false);
      }
    };
    const handleFocus = () => {
      evaluate(true);
      setIsVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    const resumeOnInteraction = (event: Event) => {
      if (wantsAlarmRef.current && audioRef.current?.state !== 'running') {
        resumeGestureAtRef.current = Date.now();
        void startAlarmAudio(false);
      }
      const target = event.target;
      const togglingWakePreference = target instanceof Element && Boolean(target.closest('[data-testid="button-keep-awake"]'));
      if (keepAwakeRef.current && !togglingWakePreference) void requestWakeLock();
    };
       document.addEventListener('click', resumeOnInteraction, true);
    document.addEventListener('touchend', resumeOnInteraction, true);
    document.addEventListener('keydown', resumeOnInteraction, true);
    return () => {
      document.removeEventListener('click', resumeOnInteraction, true);
      document.removeEventListener('touchend', resumeOnInteraction, true);
      document.removeEventListener('keydown', resumeOnInteraction, true);
    };
  }, []);

  useEffect(() => {
    if (!armed || !audioRunning || muted || activeAlarms.length === 0) return;
    const context = audioRef.current;
    if (!context || context.state !== 'running') return;
    playLoudAlarmBurst(context);
    const timer = window.setInterval(() => playLoudAlarmBurst(context), 1200);
    return () => window.clearInterval(timer);
  }, [activeAlarms, armed, audioRunning, muted]);

  useEffect(() => {
    const originalTitle = originalTitleRef.current ?? document.title;
    originalTitleRef.current = originalTitle;
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (originalFaviconRef.current === null) originalFaviconRef.current = iconLink?.href ?? '';
    const hidden = !isVisible;
    const active = activeAlarms[0];
    const warning = comingUp;
    if (!hidden || (!active && !warning)) {
      document.title = originalTitle;
      if (iconLink && originalFaviconRef.current) iconLink.href = originalFaviconRef.current;
      return;
    }

    const alertTitle = active ? `TIME NOW: ${active.entry.title}` : `COMING UP: ${warning!.entry.title}`;
    const faviconColor = active ? '#b62922' : '#c2912b';
    const alertIcon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${faviconColor}"/><path d="M32 12v23" stroke="white" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="47" r="4" fill="white"/></svg>`)}`;
    let showAlertTitle = true;
    const flash = () => {
      document.title = showAlertTitle ? alertTitle : originalTitle;
      if (iconLink) iconLink.href = alertIcon;
      showAlertTitle = !showAlertTitle;
    };
    flash();
    const timer = window.setInterval(flash, 850);
    return () => {
      window.clearInterval(timer);
      document.title = originalTitle;
      if (iconLink && originalFaviconRef.current) iconLink.href = originalFaviconRef.current;
    };
  }, [activeAlarms, comingUp, isVisible]);

  useEffect(() => () => {
    testTimersRef.current.forEach(timer => {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    });
    silentOscillatorRef.current?.stop();
    void wakeLockRef.current?.release();
    void audioRef.current?.close();
  }, []);

  const enableAlarm = async () => {
    const resumedFromThisGesture = Date.now() - resumeGestureAtRef.current < 1500;
    if (armedRef.current && audioRef.current?.state === 'running' && !resumedFromThisGesture) {
      armedRef.current = false;
      wantsAlarmRef.current = false;
      setArmed(false);
      setWantsAlarm(false);
      setResumeRequired(false);
      setAudioRunning(false);
      try {
        window.localStorage.setItem(ALARM_ENABLED_STORAGE_KEY, 'false');
      } catch {
        // Disarming applies to the current page even if browser storage is blocked.
      }
      void audioRef.current?.suspend();
      setAudioMessage('Alarm disarmed. Visual alerts remain on.');
      return;
    }
    wantsAlarmRef.current = true;
    setWantsAlarm(true);
    setResumeRequired(false);
    try {
      window.localStorage.setItem(ALARM_ENABLED_STORAGE_KEY, 'true');
    } catch {
      // Audio can still be enabled for this page.
    }
    await startAlarmAudio(true);
  };

  const toggleMute = () => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    writeStoredBoolean(ALARM_MUTED_STORAGE_KEY, nextMuted);
  };

  const toggleKeepAwake = () => {
    const next = !keepAwakeRef.current;
    keepAwakeRef.current = next;
    setKeepAwake(next);
    writeStoredBoolean(KEEP_AWAKE_STORAGE_KEY, next);
    if (next) void requestWakeLock();
    else {
      setWakeMessage('');
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      void lock?.release();
    }
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
  const alarmIndicator = !wantsAlarm ? 'Off' : armed && audioRunning ? 'Armed' : 'Waiting for tap';

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
        <span className={`alarm-ready-dot ${audioRunning ? 'armed' : ''}`} />
        <div>
          <strong>{alarmIndicator}</strong>
          <small>{alarmIndicator === 'Armed' ? 'Audio running · WAT schedule' : alarmIndicator === 'Off' ? 'Visual alerts remain on' : 'Tap or press a key to resume sound'}</small>
        </div>
      </div>
      <div className="alarm-buttons">
        <button className={`alarm-enable-btn ${armed && audioRunning ? 'armed' : ''}`} type="button" onClick={() => void enableAlarm()} aria-pressed={armed && audioRunning} data-testid="button-alarm-enable">
          {armed && audioRunning ? <BellRing size={15} /> : <Bell size={15} />}{armed && audioRunning ? 'Disable alarm' : wantsAlarm && resumeRequired ? 'Resume alarm' : 'Enable alarm'}
        </button>
        <button className={`alarm-utility-btn ${muted ? 'muted' : ''}`} type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute alarm' : 'Mute alarm'}>
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{muted ? 'Muted' : 'Mute'}
        </button>
        <button className="alarm-utility-btn" type="button" onClick={() => void testAlarm()} disabled={testPlaying} title={muted ? 'Unmute to test the alarm sound' : 'Play both alarm sounds'}>
          <BellRing size={15} />{testPlaying ? 'Testing…' : 'Test alarm'}
        </button>
        <button className={`alarm-utility-btn ${keepAwake ? 'wake-enabled' : ''}`} type="button" onClick={toggleKeepAwake} aria-pressed={keepAwake} data-testid="button-keep-awake">
          <Clock3 size={15} />{keepAwake ? 'Keep-awake on' : 'Keep screen awake'}
        </button>
      </div>
    </div>

    {resumeRequired && wantsAlarm && <div className="alarm-resume-warning" role="status" data-testid="alarm-resume-warning">
      <strong>Alarm was ON - tap anywhere to resume sound</strong>
      <span>Browsers require a fresh interaction before sound can run. Your saved alarm schedule is still active.</span>
    </div>}
    <PhonePushAlerts />
    {audioMessage && <div className="alarm-message" role="status">{audioMessage}</div>}
    {wakeMessage && <div className="alarm-message" role="status">{wakeMessage}</div>}

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