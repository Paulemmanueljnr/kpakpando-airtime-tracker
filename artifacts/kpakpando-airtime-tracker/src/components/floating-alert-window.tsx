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

const FLOATING_ALERT_STYLES = `
@keyframes kpakpando-alert-window-blink {
  0%, 49% { background: #bc2028; color: #fff; }
  50%, 100% { background: #fff; color: #a7161d; }
}
.kpakpando-floating-alert-stage {
  box-sizing: border-box;
  width: 100%;
  min-height: 100vh;
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  overflow: auto;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
}
.kpakpando-floating-alert-stage--calm {
  background: #111a22;
  color: #f6f7f3;
}
.kpakpando-floating-alert-stage--ringing {
  animation: kpakpando-alert-window-blink 0.8s steps(1, end) infinite;
}
.kpakpando-floating-alert-heading {
  margin: 0;
  font-size: clamp(26px, 8vw, 42px);
  line-height: 1.05;
  font-weight: 900;
  letter-spacing: 0.015em;
}
.kpakpando-floating-alert-slot {
  display: grid;
  gap: 8px;
  justify-items: center;
}
.kpakpando-floating-alert-title {
  margin: 0;
  font-size: clamp(20px, 6vw, 30px);
  line-height: 1.15;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.kpakpando-floating-alert-meta {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.kpakpando-floating-alert-time {
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.kpakpando-floating-alert-dismiss {
  min-height: 48px;
  padding: 10px 24px;
  border: 0;
  border-radius: 10px;
  background: #14212b;
  color: #fff;
  font: inherit;
  font-size: 17px;
  font-weight: 800;
  cursor: pointer;
}
.kpakpando-floating-alert-dismiss:focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 3px;
}
.kpakpando-floating-alert-countdown {
  font-size: clamp(30px, 10vw, 46px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}
.kpakpando-floating-alert-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  background: #bc2028;
}
`;

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map(value => String(value).padStart(2, '0')).join(':');
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
    return <main className="kpakpando-floating-alert-stage kpakpando-floating-alert-stage--ringing" role="alert" aria-live="assertive">
      <h1 className="kpakpando-floating-alert-heading">ON AIR - TIME NOW</h1>
      {ringing.map(slot => <section className="kpakpando-floating-alert-slot" key={slot.key}>
        <h2 className="kpakpando-floating-alert-title">{slot.title}</h2>
        <p className="kpakpando-floating-alert-meta">{slot.client}</p>
        <time className="kpakpando-floating-alert-time">{slot.time}</time>
        <button
          className="kpakpando-floating-alert-dismiss"
          type="button"
          onClick={() => onAcknowledge(slot.key)}
          aria-label={`Dismiss ${slot.title} at ${slot.time}`}
        >
          Dismiss
        </button>
      </section>)}
    </main>;
  }

  return <main className="kpakpando-floating-alert-stage kpakpando-floating-alert-stage--calm">
    {next
      ? <>
          <h1 className="kpakpando-floating-alert-title">{next.title}</h1>
          <p className="kpakpando-floating-alert-meta">{next.client} · {next.time}</p>
          <div className="kpakpando-floating-alert-countdown" aria-label="Countdown to next airtime slot">
            {formatCountdown(next.timestamp - nowMs)}
          </div>
        </>
      : <h1 className="kpakpando-floating-alert-title">No upcoming slots</h1>}
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
    {pipSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      {pipWindow
        ? <span role="status">Alert window pinned</span>
        : <button type="button" className="alarm-utility-btn" onClick={() => void pinAlertWindow()}>
            Pin alert window
          </button>}
      {error && <span role="status">{error}</span>}
    </div>}

    {activePipBody && createPortal(<AlertWindowContent {...props} />, activePipBody)}

    {!pipSupported && props.ringing.length > 0 && createPortal(
      <>
        <style>{FLOATING_ALERT_STYLES}</style>
        <div className="kpakpando-floating-alert-overlay">
          <AlertWindowContent {...props} />
        </div>
      </>,
      document.body,
    )}
  </>;
}
