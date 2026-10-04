import { useEffect, useState } from 'react';
import { ChevronDown, Download, Printer } from 'lucide-react';
import { getEntryStatus, type AirtimeEntry } from '@/lib/airtime-api';

type PrintKind = 'today' | 'active' | 'expiring';
type TodaySlot = { entry: AirtimeEntry; time: string };

function printDateTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function PrintTools({ entries, todaySlots, today }: { entries: AirtimeEntry[]; todaySlots: TodaySlot[]; today: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [printKind, setPrintKind] = useState<PrintKind | null>(null);

  useEffect(() => {
    if (!printKind) return;
    const afterPrint = () => setPrintKind(null);
    window.addEventListener('afterprint', afterPrint);
    const timer = window.setTimeout(() => window.print(), 100);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [printKind]);

  const downloadCsv = () => {
    const lines = [
      ['Type', 'Client', 'Title', 'Payment status', 'Contract status', 'Start date', 'End date', 'Time slots (WAT)', 'Days of week', 'Notes'],
      ...entries.map(entry => [
        entry.type,
        entry.client,
        entry.title,
        entry.paymentStatus,
        getEntryStatus(entry, today),
        entry.startDate,
        entry.endDate,
        entry.timeSlots.join(' | '),
        entry.type === 'Sponsored Program' ? (entry.daysOfWeek.length ? entry.daysOfWeek.join(' | ') : 'Every day') : '',
        entry.notes ?? '',
      ]),
    ];
    const csv = `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `kpakpando-airtime-${today}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const startPrint = (kind: PrintKind) => {
    setPrintKind(kind);
    setMenuOpen(false);
  };

  return <>
    <div className="print-tools">
      <div className="print-menu-wrap">
        <button className="quiet-btn" type="button" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-haspopup="menu" data-testid="button-print-menu">
          <Printer size={15} /> Print <ChevronDown size={13} />
        </button>
        {menuOpen && <div className="print-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => startPrint('today')}>Today’s log sheet</button>
          <button type="button" role="menuitem" onClick={() => startPrint('active')}>Active entries list</button>
          <button type="button" role="menuitem" onClick={() => startPrint('expiring')}>Expiring this week</button>
        </div>}
      </div>
      <button className="quiet-btn" type="button" onClick={downloadCsv} data-testid="button-export-csv"><Download size={15} /> CSV</button>
    </div>

    {printKind && <PrintSheet kind={printKind} entries={entries} todaySlots={todaySlots} today={today} />}
  </>;
}

function PrintSheet({ kind, entries, todaySlots, today }: { kind: PrintKind; entries: AirtimeEntry[]; todaySlots: TodaySlot[]; today: string }) {
  const activeEntries = entries
    .filter(entry => {
      const status = getEntryStatus(entry, today);
      return status === 'active' || status === 'expiring-soon';
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.timeSlots[0]?.localeCompare(b.timeSlots[0] ?? '') || 0);
  const expiringEntries = entries
    .filter(entry => getEntryStatus(entry, today) === 'expiring-soon')
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const logRows = [...todaySlots].sort((a, b) => a.time.localeCompare(b.time));
  const title = kind === 'today' ? 'Today’s log sheet' : kind === 'active' ? 'Active entries' : 'Expiring this week';
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${today}T12:00:00.000Z`));

  return <section className="print-sheet" aria-label={`Print preview: ${title}`}>
    <header className="print-header">
      <img src="/kpakpando-station-logo.png" alt="Kpakpando station logo" />
      <div><h1>Kpakpando Airtime Tracker</h1><h2>{title}</h2></div>
      <div className="print-datetime"><strong>{dateLabel} · WAT</strong><span>Printed {printDateTime()} · WAT</span></div>
    </header>
    {kind === 'today' ? <table className="print-table">
      <thead><tr><th>Time</th><th>Client</th><th>Title</th><th>Type</th><th>Aired</th><th>Initials</th></tr></thead>
      <tbody>{logRows.length ? logRows.map((slot, index) => <tr key={`${slot.entry.id}-${slot.time}-${index}`}>
        <td>{slot.time}</td><td>{slot.entry.client}</td><td>{slot.entry.title}</td><td>{slot.entry.type}</td><td><span className="print-checkbox" /></td><td className="print-initials" />
      </tr>) : <tr><td colSpan={6}>No airtime is scheduled for today.</td></tr>}</tbody>
    </table> : <table className="print-table">
      <thead><tr><th>Client</th><th>Title</th><th>Type</th><th>Payment</th><th>Contract dates</th><th>Times · WAT</th>{kind === 'expiring' && <th>Days left</th>}</tr></thead>
      <tbody>{(kind === 'active' ? activeEntries : expiringEntries).length
        ? (kind === 'active' ? activeEntries : expiringEntries).map(entry => <tr key={entry.id}>
          <td>{entry.client}</td><td>{entry.title}</td><td>{entry.type}</td><td>{entry.paymentStatus}</td><td>{entry.startDate} – {entry.endDate}</td><td>{entry.timeSlots.join(', ')}</td>{kind === 'expiring' && <td>{getEntryStatus(entry, today) === 'expiring-soon' ? (entry.endDate === today ? 'Ends today' : `${Math.ceil((Date.parse(`${entry.endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)} days`) : ''}</td>}
        </tr>)
        : <tr><td colSpan={kind === 'expiring' ? 7 : 6}>No entries in this list.</td></tr>}</tbody>
    </table>}
  </section>;
}