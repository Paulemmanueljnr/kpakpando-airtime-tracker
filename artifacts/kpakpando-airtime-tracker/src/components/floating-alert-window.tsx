import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type RingingAlert = {
  key: string;
  title: string;
  client: string;
  time: string;
};

type NextAlert = {
  title: string;
  client: string;
  time: string;
  timestamp: number;
};

type FloatingAlertWindowProps = {
  ringing: RingingAlert[];
  next: NextAlert | null;
  nowMs: number;
  onAcknowledge: (key: string) => void;
};

type DocumentPictureInPictureApi = {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureApi;
};

const SOON_WINDOW_MS = 5 * 60 * 1000;

const FLOATING_ALERT_STYLES = `
@keyframes kp-blink {
  0%, 49% { background: #c4202a; color: #ffffff; }
  50%, 100% { background: #ffffff; color: #b3141c; }
}
@keyframes kp-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0.45; }
}
@keyframes kp-shake {
  0%, 100% { transform: rotate(0deg); }
  20% { transform: rotate(14deg); }
  40% { transform: rotate(-14deg); }
  60% { transform: rotate(10deg); }
  80% { transform: rotate(-10deg); }
}
.kp-stage {
  box-sizing: border-box;
  width: 100%;
  min-height: 100vh;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  overflow: auto;
  text-align: center;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.kp-calm {
  background: radial-gradient(circle at 15% 0%, #1f5a50 0%, #112027 55%, #0b141a 100%);
  color: #f5f3ea;
}
.kp-soon {
  background: radial-gradient(circle at 15% 0%, #6b4e12 0%, #231a08 60%, #140f05 100%);
  color: #fff6dd;
}
.kp-ringing {
  animation: kp-blink 0.8s steps(1, end) infinite;
  gap: 8px;
}
.kp-over {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  opacity: 0.85;
}
.kp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4be3a4;
  animation: kp-pulse 1.4s ease-in-out infinite;
}
.kp-soon .kp-dot { background: #ffc94a; }
.kp-title {
  margin: 0;
  max-width: 100%;
  font-size: clamp(18px, 5.4vw, 26px);
  line-height: 1.15;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.kp-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.kp-chip {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  font-size: 13px;
  font-weight: 700;
}
.kp-ringing .kp-chip {
  background: rgba(0, 0, 0, 0.12);
  border-color: currentColor;
}
.kp-clock {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.kp-seg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.kp-num {
  min-width: 62px;
  padding: 6px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 34px;
  line-height: 1.1;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
}
.kp-lab {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.2em;
  opacity: 0.6;
}
.kp-sep {
  padding-top: 6px;
  font-size: 30px;
  font-weight: 800;
  opacity: 0.5;
}
.kp-bell {
  display: block;
  animation: kp-shake 0.9s ease-in-out infinite;
  transform-origin: 50% 10%;
}
.kp-heading {
  margin: 0;
  font-size: clamp(24px, 7.5vw, 36px);
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: 0.03em;
}
.kp-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.kp-dismiss {
  min-height: 44px;
  padding: 8px 34px;
  border: 0;
  border-radius: 999px;
  background: #101820;
  color: #ffffff;
  font: inherit;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.kp-dismiss:hover { filter: brightness(1.25); }
.kp-dismiss:focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 3px;
}
.kp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  background: #c4202a;
}
`;

const PIN_BUTTON_STYLES = `
.kp-pin-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border: 1px solid #1f6f62;
  border-radius: 999px;
  background: linear-gradient(135deg, #1f7a6c, #14453d);
  color: #ffffff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(20, 69, 61, 0.35);
}
.kp-pin-btn:hover { filter: brightness(1.12); }
.kp-pin-btn:focus-visible { outline: 3px solid #4be3a4; outline-offset: 2px; }
.kp-pinned {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #e3f2ee;
  color: #14453d;
  font-size: 13px;
  font-weight: 700;
}
.kp-pinned::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1fa57f;
}
`;

function PinIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>;
}

function BellIcon() {
  return <svg className="kp-bell" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>;
}

function countdownParts(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return {
    hours: String(Math.floor(seconds / 3600)).padStart(2, '0'),
    minutes: String(Math.floor((seconds % 3600) / 60)).padStart(2, '0'),
    seconds: String(seconds % 60).padStart(2, '0'),
  };
}

function copyPageStylesheets(source: Document, target: Document) {
  for (const stylesheet of Array.from(source.styleSheets)) {
    try {
      const rules = Array.from(stylesheet.cssRules).map(rule => rule.cssText).join('\n');
      if (rules) {
        const style = target.createElement('style');
        style.textContent = rules;
        if (stylesheet.media.mediaText) style.media = stylesheet.media.mediaText;
        target.head.appendChild(style);
        continue;
      }
    } catch {
      // Cross-origin stylesheets cannot expose cssRules; use their URL below.
    }

    if (stylesheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = stylesheet.href;
      if (stylesheet.media.mediaText) link.media = stylesheet.media.mediaText;
      target.head.appendChild(link);
    }
  }
}

function AlertWindowContent({
  ringing,
  next,
  nowMs,
  onAcknowledge,
}: FloatingAlertWindowProps) {
  if (ringing.length > 0) {
    return <main className="kp-stage kp-ringing" role="alert" aria-live="assertive">
      <BellIcon />
      <h1 className="kp-heading">ON AIR · TIME NOW</h1>
      {ringing.map(slot => <section className="kp-slot" key={slot.key}>
        <h2 className="kp-title">{slot.title}</h2>
        <div className="kp-chips">
          <span className="kp-chip">{slot.client}</span>
          <span className="kp-chip">{slot.time}</span>
        </div>
        <button
          className="kp-dismiss"
          type="button"
          onClick={() => onAcknowledge(slot.key)}
          aria-label={`Dismiss ${slot.title} at ${slot.time}`}
        >
          DISMISS
        </button>
      </section>)}
    </main>;
  }

  if (!next) {
    return <main className="kp-stage kp-calm">
      <div className="kp-over"><span className="kp-dot" />STANDING BY</div>
      <h1 className="kp-title">No upcoming slots</h1>
    </main>;
  }

  const remaining = next.timestamp - nowMs;
  const soon = remaining > 0 && remaining <= SOON_WINDOW_MS;
  const parts = countdownParts(remaining);

  return <main className={`kp-stage ${soon ? 'kp-soon' : 'kp-calm'}`}>
    <div className="kp-over"><span className="kp-dot" />{soon ? 'COMING UP · UNDER 5 MIN' : 'NEXT UP · WAT'}</div>
    <h1 className="kp-title">{next.title}</h1>
    <div className="kp-chips">
      <span className="kp-chip">{next.client}</span>
      <span className="kp-chip">{next.time}</span>
    </div>
    <div className="kp-clock" aria-label="Countdown to next airtime slot">
      <div className="kp-seg"><div className="kp-num">{parts.hours}</div><div className="kp-lab">HRS</div></div>
      <div className="kp-sep">:</div>
      <div className="kp-seg"><div className="kp-num">{parts.minutes}</div><div className="kp-lab">MIN</div></div>
      <div className="kp-sep">:</div>
      <div className="kp-seg"><div className="kp-num">{parts.seconds}</div><div className="kp-lab">SEC</div></div>
    </div>
  </main>;
}

export function FloatingAlertWindow(props: FloatingAlertWindowProps) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [error, setError] = useState('');
  const pipSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

  useEffect(() => {
    if (!pipWindow) return;
    const handlePageHide = () => setPipWindow(null);
    pipWindow.addEventListener('pagehide', handlePageHide);
    return () => pipWindow.removeEventListener('pagehide', handlePageHide);
  }, [pipWindow]);

  useEffect(() => () => {
    if (pipWindow && !pipWindow.closed) pipWindow.close();
  }, [pipWindow]);

  const pinAlertWindow = async () => {
    const pipApi = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
    if (!pipApi) return;

    setError('');
    try {
      const openedWindow = await pipApi.requestWindow({ width: 420, height: 260 });
      copyPageStylesheets(document, openedWindow.document);
      openedWindow.document.title = 'Kpakpando alert window';
      openedWindow.document.body.replaceChildren();
      openedWindow.document.body.style.margin = '0';
      openedWindow.document.body.style.minWidth = '0';
      openedWindow.document.body.style.overflow = 'hidden';

      const style = openedWindow.document.createElement('style');
      style.textContent = FLOATING_ALERT_STYLES;
      openedWindow.document.head.appendChild(style);
      setPipWindow(openedWindow);
    } catch {
      setError('Could not open the alert window. Try again from this page.');
    }
  };

  const activePipBody = pipWindow && !pipWindow.closed ? pipWindow.document.body : null;

  return <>
    {pipSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
      <style>{PIN_BUTTON_STYLES}</style>
      {pipWindow
        ? <span className="kp-pinned" role="status">Alert window pinned</span>
        : <button type="button" className="kp-pin-btn" onClick={() => void pinAlertWindow()}>
            <PinIcon />Pin alert window
          </button>}
      {error && <span role="status">{error}</span>}
    </div>}

    {activePipBody && createPortal(<AlertWindowContent {...props} />, activePipBody)}

    {!pipSupported && props.ringing.length > 0 && createPortal(
      <>
        <style>{FLOATING_ALERT_STYLES}</style>
        <div className="kp-overlay">
          <AlertWindowContent {...props} />
        </div>
      </>,
      document.body,
    )}
  </>;
}