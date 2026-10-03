import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import stationLogo from '@assets/kpakpando_logo_original_1791056328993.png';
import {
  useCreateEntry,
  useDeleteEntry,
  useGetDashboardSummary,
  useListEntries,
  useUpdateEntry,
  getEntryCountdown,
  getEntryStatus,
  getLagosTime,
  getLagosToday,
  getLagosWeekday,
  isDemoMode,
  type AirtimeEntry,
  type AirtimeEntryInput,
  type AirtimeType,
  type Weekday,
} from '@/lib/airtime-api';
import NotFound from '@/pages/not-found';
import {
  Activity,
  Archive,
  AudioLines,
  Check,
  Clock3,
  CreditCard,
  FileAudio,
  LayoutDashboard,
  Menu,
  Mic2,
  Pencil,
  Plus,
  Radio,
  RotateCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const weekdays: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
type ViewTab = 'All' | 'Jingles' | 'Sponsored Programs' | 'On Air Today';
type ModalState = { kind: 'create' } | { kind: 'edit' | 'renew'; entry: AirtimeEntry } | { kind: 'delete'; entry: AirtimeEntry };

function BrandMark() {
  return <div className="brand-mark" role="img" aria-label="Kpakpando station logo">
    <img className="brand-logo" src={stationLogo} alt="" />
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setMenuOpen(false), [location]);
  return <div className="shell">
    <div className={`sidebar ${menuOpen ? 'open' : ''}`}>
    <div className="brand"><BrandMark /><div><div className="brand-name">Kpakpando</div><div className="brand-sub">Airtime tracker</div></div></div>
      <div className="side-label">Operations</div>
      <Link href="/" className={`side-link ${location === '/' ? 'active' : ''}`}><LayoutDashboard /> <span>Dashboard</span></Link>
      <Link href="/expired" className={`side-link ${location === '/expired' ? 'active' : ''}`}><Archive /> <span>Expired entries</span></Link>
      <div className="sidebar-bottom">
        <div className="side-label">Shift status</div>
        <div className="shift-card"><div className="shift-top"><span className="live-dot" /> CONTROL ROOM READY</div><div className="shift-time">{getLagosTime(clock)} WAT · LAGOS</div></div>
      </div>
    </div>
    <main className="main">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" data-testid="button-menu"><Menu size={17} /></button>
        <div className="crumb"><BrandMark /><span>Operations <span style={{ padding: '0 7px', color: '#abb2aa' }}>/</span> <strong style={{ color: 'hsl(var(--foreground))' }}>{location === '/expired' ? 'Expired entries' : 'Airtime overview'}</strong></span></div>
        <div className="topbar-right"><span className="timezone"><Clock3 size={14} /> {getLagosTime(clock)} WAT</span>{isDemoMode && <span className="demo-pill">BROWSER DEMO</span>}</div>
      </header>
      {children}
    </main>
  </div>;
}

function Dashboard({ expired = false }: { expired?: boolean }) {
  const entriesQuery = useListEntries();
  const summaryQuery = useGetDashboardSummary();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const [tab, setTab] = useState<ViewTab>('All');
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('All payments');
  const [typeFilter, setTypeFilter] = useState('All types');
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(new Date());
  const today = getLagosToday(now);
  const currentTime = getLagosTime(now);
  const todayWeekday = getLagosWeekday(now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const entries = entriesQuery.data ?? [];
  const activeEntries = useMemo(() => entries.filter(entry => getEntryStatus(entry, today) !== 'expired'), [entries, today]);
  const expiredEntries = useMemo(() => entries.filter(entry => getEntryStatus(entry, today) === 'expired').sort((a, b) => b.endDate.localeCompare(a.endDate)), [entries, today]);
  const onAirSlots = useMemo(() => activeEntries
    .filter(entry => entry.startDate <= today && entry.endDate >= today)
    .filter(entry => entry.type !== 'Sponsored Program' || entry.daysOfWeek.length === 0 || entry.daysOfWeek.includes(todayWeekday))
    .flatMap(entry => entry.timeSlots.map(time => ({ entry, time })))
    .sort((a, b) => a.time.localeCompare(b.time)), [activeEntries, today, todayWeekday]);
  const nextSlotIndex = onAirSlots.findIndex(slot => slot.time >= currentTime);
  const source = expired ? expiredEntries : activeEntries;
  const sorted = useMemo(() => [...source].sort((a, b) => {
    if (!expired && tab === 'On Air Today') {
      const nextTime = (entry: AirtimeEntry) => entry.timeSlots.filter(time => time >= currentTime).sort()[0] ?? entry.timeSlots.slice().sort()[0] ?? '99:99';
      return nextTime(a).localeCompare(nextTime(b)) || a.endDate.localeCompare(b.endDate);
    }
    return a.endDate.localeCompare(b.endDate);
  }), [source, expired, tab, currentTime]);
  const filtered = useMemo(() => sorted.filter(entry => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [entry.client, entry.title, entry.type, entry.notes ?? ''].some(value => value.toLowerCase().includes(needle));
    const matchesPayment = paymentFilter === 'All payments' || entry.paymentStatus === paymentFilter;
    const matchesType = typeFilter === 'All types' || entry.type === typeFilter;
    const matchesTab = expired || tab === 'All' || (tab === 'Jingles' && entry.type === 'Jingle') || (tab === 'Sponsored Programs' && entry.type === 'Sponsored Program') || (tab === 'On Air Today' && onAirSlots.some(slot => slot.entry.id === entry.id));
    return matchesSearch && matchesPayment && matchesType && matchesTab;
  }), [sorted, search, paymentFilter, typeFilter, tab, expired, onAirSlots]);

  const closeModal = () => setModal(null);
  const actionError = createEntry.error || updateEntry.error || deleteEntry.error;
  const handleSubmit = async (data: AirtimeEntryInput) => {
    if (!modal || modal.kind === 'delete') return;
    try {
      if (modal.kind === 'create') await createEntry.mutateAsync({ data });
      else await updateEntry.mutateAsync({ id: modal.entry.id, data });
      setToast(modal.kind === 'create' ? 'Airtime entry added to the desk.' : modal.kind === 'renew' ? 'Airtime renewed and saved.' : 'Entry changes saved.');
      closeModal();
    } catch {
      // Mutation errors are shown inside the active form.
    }
  };
  const handleDelete = async (entry: AirtimeEntry) => {
    try {
      await deleteEntry.mutateAsync({ id: entry.id });
      setToast(getEntryStatus(entry, today) === 'expired' ? 'Expired entry permanently deleted.' : 'Entry removed from the airtime log.');
      closeModal();
    } catch {
      setToast('Delete failed. Please try again.');
    }
  };
  const retry = () => { void entriesQuery.refetch(); void summaryQuery.refetch(); };
  const summary = summaryQuery.data;
  const tabs: ViewTab[] = ['All', 'Jingles', 'Sponsored Programs', 'On Air Today'];
  const title = expired ? 'Expired entries' : 'Airtime overview';

  return <div className="content">
    <section className="page-head">
      <div><div className="eyebrow">{expired ? 'Archive / expired' : 'Transmission desk · live shift'}</div><h1 className="page-title">{title}</h1><p className="page-note">{expired ? 'Past contracts, ready to renew or clear from the desk.' : 'Every booked second, accounted for.'}</p></div>
      {!expired && <button className="primary-btn" onClick={() => setModal({ kind: 'create' })} data-testid="button-add-entry"><Plus size={16} /> Add entry</button>}
    </section>
    {!expired && <section className="summary-grid" aria-label="Airtime summary">
      <SummaryCard label="Active" value={summary?.active} icon={<Activity />} wash="#e3eee6" ink="#286e5c" />
      <SummaryCard label="Expiring soon" value={summary?.expiringSoon} icon={<Clock3 />} wash="#f5ebd1" ink="#a47720" />
      <SummaryCard label="Unpaid" value={summary?.unpaid} icon={<CreditCard />} wash="#f5e5dd" ink="#9a4d3e" />
      <SummaryCard label="Airing today" value={summary?.airingToday} icon={<Radio />} wash="#e3ebee" ink="#426b7a" />
    </section>}

    {!expired && tab === 'On Air Today' && <section className="airing-panel">
      <div className="airing-head"><div><div className="airing-title"><AudioLines size={16} /> Today’s running order</div><div className="airing-sub">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long' }).format(now)} · WAT</div></div><span className="badge active-state">{onAirSlots.length} slots</span></div>
      {onAirSlots.length === 0 ? <div className="airing-sub" style={{ padding: '12px 2px 3px' }}>No scheduled airtime on today’s log.</div> : onAirSlots.map((slot, i) => {
        const isNext = i === nextSlotIndex;
        return <div className={`airing-row ${isNext ? 'next' : ''}`} key={`${slot.entry.id}-${slot.time}`}>
          <div className="airing-time">{slot.time}</div>
          <div><div className="entry-title">{slot.entry.title}</div><div className="entry-client">{slot.entry.client} · {slot.entry.type}</div></div>
          {isNext ? <span className="next-tag">Next up</span> : <span className="airing-sub">{slot.time < currentTime ? 'Aired' : 'Scheduled'}</span>}
        </div>;
      })}
    </section>}

    <div className="toolbar">
      <div className="search-wrap"><Search /><input className="search-input" type="search" placeholder="Search client, title or notes…" value={search} onChange={event => setSearch(event.target.value)} data-testid="input-search" /></div>
      <select className="filter-select" value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)} aria-label="Filter by payment status" data-testid="filter-payment">
        <option>All payments</option><option>Paid</option><option>Unpaid</option>
      </select>
      {expired && <select className="filter-select" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} aria-label="Filter by entry type" data-testid="filter-type"><option>All types</option><option>Jingle</option><option>Sponsored Program</option></select>}
      {!expired && <button className="quiet-btn" onClick={() => { setPaymentFilter('All payments'); setSearch(''); setTypeFilter('All types'); setTab('All'); }} data-testid="button-clear-filters">Clear</button>}
    </div>

    {!expired && <nav className="tabs" aria-label="Entry views">
      {tabs.map((item, index) => <button key={item} className={`tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)} data-testid={`tab-${item.toLowerCase().replaceAll(' ', '-')}`}>
        {item}{index === 0 ? <span className="tab-count">{activeEntries.length}</span> : item === 'On Air Today' ? <span className="tab-count">{onAirSlots.length}</span> : <span className="tab-count">{activeEntries.filter(entry => item === 'Jingles' ? entry.type === 'Jingle' : entry.type === 'Sponsored Program').length}</span>}
      </button>)}
    </nav>}
    {expired && <div className="eyebrow" style={{ marginTop: 20, marginBottom: 0 }}>{filtered.length} archived {filtered.length === 1 ? 'entry' : 'entries'}</div>}

    <div className="entry-list">
      {entriesQuery.isLoading ? <><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></> :
        entriesQuery.isError ? <div className="state-panel"><div className="empty-symbol"><Radio size={18} /></div><h3>Desk connection interrupted</h3><p>We couldn’t load the airtime log. Your entries are still safe.</p><button className="quiet-btn" onClick={retry} data-testid="button-retry">Try again</button></div> :
          filtered.length === 0 ? <div className="empty-state"><div className="empty-symbol">{expired ? <Archive size={18} /> : search || paymentFilter !== 'All payments' ? <Search size={18} /> : <Mic2 size={18} />}</div><h3>{expired ? 'No expired entries' : search || paymentFilter !== 'All payments' ? 'No matching airtime' : tab === 'On Air Today' ? 'Nothing on today’s log' : 'The airtime desk is clear'}</h3><p>{expired ? 'Entries appear here after their end date passes.' : search || paymentFilter !== 'All payments' ? 'Try another search or clear the payment filter.' : tab === 'On Air Today' ? 'No active entries are scheduled to air today.' : 'Add the first jingle or sponsored program to begin the log.'}</p>{!expired && !search && <button className="primary-btn" onClick={() => setModal({ kind: 'create' })} data-testid="button-add-first-entry"><Plus size={15} /> Add entry</button>}</div> :
            filtered.map(entry => <EntryRow key={entry.id} entry={entry} expired={expired} onEdit={() => setModal({ kind: 'edit', entry })} onRenew={() => setModal({ kind: 'renew', entry })} onDelete={() => setModal({ kind: 'delete', entry })} />)}
    </div>
    {actionError && !modal && <div className="alert-note" role="alert">A change could not be saved. Check the connection and try again.</div>}
    {modal && modal.kind !== 'delete' && <EntryModal state={modal} busy={createEntry.isPending || updateEntry.isPending} error={actionError instanceof Error ? actionError.message : ''} onClose={closeModal} onSubmit={handleSubmit} />}
    {modal?.kind === 'delete' && <ConfirmDelete entry={modal.entry} expired={expired} busy={deleteEntry.isPending} onCancel={closeModal} onConfirm={() => void handleDelete(modal.entry)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function SummaryCard({ label, value, icon, wash, ink }: { label: string; value?: number; icon: ReactNode; wash: string; ink: string }) {
  return <div className="summary-card" style={{ '--wash': wash, '--ink': ink } as React.CSSProperties} data-testid={`summary-${label.toLowerCase().replaceAll(' ', '-')}`}><div><div className="summary-label">{label}</div><div className="summary-value">{value ?? '—'}</div></div><div className="summary-icon">{icon}</div></div>;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${date}T12:00:00.000Z`));
}

function EntryRow({ entry, expired, onEdit, onRenew, onDelete }: { entry: AirtimeEntry; expired: boolean; onEdit: () => void; onRenew: () => void; onDelete: () => void }) {
  const status = getEntryStatus(entry, getLagosToday());
  const statusText = status === 'expiring-soon' ? 'Expiring soon' : status === 'not-started' ? 'Not started' : status === 'expired' ? 'Expired' : 'Active';
  return <article className={`entry-row ${expired ? 'expired-entry' : ''}`} data-testid={`entry-${entry.id}`}>
    <div className="entry-main"><div className={`type-mark ${entry.type === 'Sponsored Program' ? 'program' : ''}`}>{entry.type === 'Jingle' ? <FileAudio /> : <Mic2 />}</div><div style={{ minWidth: 0 }}><div className="entry-title">{entry.title}</div><div className="entry-client">{entry.client} <span style={{ padding: '0 4px' }}>·</span> {entry.type}</div></div></div>
    <div className="status-cell"><div className="cell-label">Contract</div><div className="status-line"><span className="status-dot" style={{ '--status-color': status === 'expiring-soon' ? '#b48428' : status === 'expired' ? '#a94439' : status === 'not-started' ? '#607883' : '#38816c' } as React.CSSProperties} /><span className={`badge ${status === 'expiring-soon' ? 'expiring-state' : status === 'not-started' ? 'start-state' : status === 'expired' ? 'expired-state' : 'active-state'}`}>{statusText}</span></div></div>
    <div className="expiry-cell"><div className="cell-label">{expired ? 'Ended' : 'Countdown'}</div><div className="cell-value">{expired ? getEntryCountdown(entry) : getEntryCountdown(entry)}</div></div>
    <div className="schedule-cell"><div className="cell-label">Airing · dates</div><div className="cell-value schedule-info"><div className="schedule-primary">{entry.timeSlots.join(' · ') || 'No time set'}</div><div className="schedule-secondary">{formatDate(entry.startDate)} – {formatDate(entry.endDate)}</div>{entry.type === 'Sponsored Program' && <div className="schedule-secondary">{entry.daysOfWeek.length ? entry.daysOfWeek.map(day => day.slice(0, 3)).join(' · ') : 'Every day'}</div>}</div></div>
    <div className="payment-cell"><div className="cell-label">Payment</div><span className={`badge ${entry.paymentStatus === 'Paid' ? 'paid' : 'unpaid'}`}>{entry.paymentStatus === 'Paid' ? <Check size={11} /> : <CreditCard size={11} />}{entry.paymentStatus}</span></div>
    <div className="entry-actions">{expired ? <><button className="icon-btn" title="Renew entry" aria-label={`Renew ${entry.title}`} onClick={onRenew} data-testid={`button-renew-${entry.id}`}><RotateCw /></button><button className="icon-btn" title="Permanently delete" aria-label={`Permanently delete ${entry.title}`} onClick={onDelete} data-testid={`button-delete-${entry.id}`}><Trash2 /></button></> : <><button className="icon-btn" title="Edit entry" aria-label={`Edit ${entry.title}`} onClick={onEdit} data-testid={`button-edit-${entry.id}`}><Pencil /></button><button className="icon-btn" title="Renew entry" aria-label={`Renew ${entry.title}`} onClick={onRenew} data-testid={`button-renew-${entry.id}`}><RotateCw /></button><button className="icon-btn" title="Remove entry" aria-label={`Remove ${entry.title}`} onClick={onDelete} data-testid={`button-remove-${entry.id}`}><Trash2 /></button></>}</div>
  </article>;
}

function EntryModal({ state, busy, error, onClose, onSubmit }: { state: Exclude<ModalState, { kind: 'delete' }>; busy: boolean; error: string; onClose: () => void; onSubmit: (data: AirtimeEntryInput) => void }) {
  const existing = state.kind === 'create' ? undefined : state.entry;
  const isRenew = state.kind === 'renew';
  const [type, setType] = useState<AirtimeType>(existing?.type ?? 'Jingle');
  const [client, setClient] = useState(existing?.client ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [payment, setPayment] = useState(existing?.paymentStatus ?? 'Unpaid');
  const [startDate, setStartDate] = useState(isRenew ? getLagosToday() : existing?.startDate ?? getLagosToday());
  const [endDate, setEndDate] = useState(isRenew ? addDays(getLagosToday(), 30) : existing?.endDate ?? addDays(getLagosToday(), 30));
  const [times, setTimes] = useState(existing?.timeSlots.join(', ') ?? '');
  const [days, setDays] = useState<Weekday[]>(existing?.daysOfWeek ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [validation, setValidation] = useState('');
  const toggleDay = (day: Weekday) => setDays(current => current.includes(day) ? current.filter(item => item !== day) : weekdays.filter(item => current.includes(item) || item === day));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const slots = times.split(',').map(item => item.trim()).filter(Boolean);
    if (!client.trim() || !title.trim()) return setValidation('Client and title are required.');
    if (!startDate || !endDate || endDate < startDate) return setValidation('End date must be on or after the start date.');
    if (!slots.length || slots.some(time => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return setValidation('Enter one or more times in 24-hour HH:mm format, separated by commas.');
    setValidation('');
    onSubmit({ type, client: client.trim(), title: title.trim(), paymentStatus: payment, startDate, endDate, timeSlots: Array.from(new Set(slots)).sort(), daysOfWeek: type === 'Sponsored Program' ? days : [], notes: notes.trim() || undefined });
  };
  const heading = state.kind === 'create' ? 'Add airtime' : state.kind === 'renew' ? 'Renew airtime' : 'Edit airtime';
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title">
      <div className="modal-head"><div><h2 id="entry-modal-title">{heading}</h2><p>{isRenew ? 'Keep the schedule, set the new contract window.' : 'Log the booking details for the transmission desk.'}</p></div><button className="icon-btn" onClick={onClose} aria-label="Close form"><X /></button></div>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label htmlFor="entry-type">Entry type</label><select id="entry-type" value={type} onChange={event => setType(event.target.value as AirtimeType)} data-testid="input-entry-type"><option>Jingle</option><option>Sponsored Program</option></select></div>
          <div className="field"><label htmlFor="entry-payment">Payment status</label><select id="entry-payment" value={payment} onChange={event => setPayment(event.target.value as 'Paid' | 'Unpaid')} data-testid="input-payment-status"><option>Unpaid</option><option>Paid</option></select></div>
          <div className="field"><label htmlFor="entry-client">Client</label><input id="entry-client" value={client} onChange={event => setClient(event.target.value)} maxLength={120} placeholder="Client or sponsor" data-testid="input-client" /></div>
          <div className="field"><label htmlFor="entry-title">Title / program name</label><input id="entry-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={160} placeholder="What goes on air?" data-testid="input-title" /></div>
          <div className="field"><label htmlFor="entry-start">Start date</label><input id="entry-start" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} data-testid="input-start-date" /></div>
          <div className="field"><label htmlFor="entry-end">End date</label><input id="entry-end" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} data-testid="input-end-date" /></div>
          <div className="field full"><label htmlFor="entry-times">Airing times · 24-hour, comma separated</label><input id="entry-times" value={times} onChange={event => setTimes(event.target.value)} placeholder="06:30, 12:45, 19:50" data-testid="input-time-slots" /></div>
          {type === 'Sponsored Program' && <div className="field full"><label>Days of week · leave unselected for every day</label><div className="days">{weekdays.map(day => <button key={day} type="button" className={`day-chip ${days.includes(day) ? 'selected' : ''}`} onClick={() => toggleDay(day)} aria-pressed={days.includes(day)} data-testid={`day-${day.toLowerCase()}`}>{day.slice(0, 3)}</button>)}</div></div>}
          <div className="field full"><label htmlFor="entry-notes">Notes · optional</label><textarea id="entry-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} placeholder="Production or scheduling notes" data-testid="input-notes" /></div>
        </div>
        {(validation || error) && <div className="form-error" role="alert">{validation || error}</div>}
        <div className="modal-actions"><button type="button" className="quiet-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-btn" disabled={busy} data-testid="button-submit-entry">{busy ? 'Saving…' : heading}</button></div>
      </form>
    </section>
  </div>;
}

function ConfirmDelete({ entry, expired, busy, onCancel, onConfirm }: { entry: AirtimeEntry; expired: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" style={{ maxWidth: 430 }}>
      <div className="modal-head"><div><h2 id="delete-title">{expired ? 'Delete this entry?' : 'Remove this entry?'}</h2><p>{expired ? 'Permanent action · expired airtime' : 'This airtime will be removed from the log.'}</p></div><button className="icon-btn" onClick={onCancel} aria-label="Close confirmation" data-testid="button-close-confirm"><X /></button></div>
      <div className="modal-body"><p className="confirm-copy"><strong>{entry.title}</strong> for {entry.client} will be removed from the airtime log. This cannot be undone.</p>{expired && <div className="alert-note">This entry ended {formatDate(entry.endDate)}. Renew it instead if the booking is continuing.</div>}<div className="modal-actions"><button className="quiet-btn" onClick={onCancel} disabled={busy} data-testid="button-cancel-delete">Keep entry</button><button className="danger-btn" onClick={onConfirm} disabled={busy} data-testid="button-confirm-delete">{busy ? 'Removing…' : expired ? 'Permanently delete' : 'Remove entry'}</button></div></div>
    </section>
  </div>;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function Router() {
  return <RoutedErrorBoundary><Shell><Switch>
    <Route path="/" component={() => <Dashboard />} />
    <Route path="/expired" component={() => <Dashboard expired />} />
    <Route component={NotFound} />
  </Switch></Shell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;