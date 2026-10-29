import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Printer, Users, CheckSquare, UserRound, Download } from 'lucide-react';
import { api, download, fmtDate, fmtDateTime, todayISO } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Tabs, SearchBox, Pagination, useMeta } from '../components/ui.jsx';
import { ColumnChart, BarList, ChartCard, SERIES } from '../components/Charts.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function presetRange(p) {
  const now = new Date();
  const d = new Date(now);
  if (p === 'today') return [iso(now), iso(now)];
  if (p === 'yesterday') {
    d.setDate(d.getDate() - 1);
    return [iso(d), iso(d)];
  }
  if (p === 'week') {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return [iso(d), iso(now)];
  }
  if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
  if (p === '30') {
    d.setDate(d.getDate() - 29);
    return [iso(d), iso(now)];
  }
  return null;
}
const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['30', 'Last 30 days'],
  ['custom', 'Custom'],
];

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d, long) => (long ? fmtDate(d) : `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`);
const hourLabel = (h, long) => (long ? `${String(h).padStart(2, '0')}:00 – ${String(h).padStart(2, '0')}:59` : `${String(h).padStart(2, '0')}`);
const mins = (v) => (v == null ? '—' : v >= 60 ? `${Math.floor(v / 60)} h ${v % 60} min` : `${v} min`);

function Kpi({ label, value, hint, hero }) {
  return (
    <div className={`card kpi ${hero ? 'hero' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

const STATUS_SERIES = [
  { key: 'approved', label: 'Approved', color: SERIES.s1 },
  { key: 'rejected', label: 'Rejected', color: SERIES.s2 },
  { key: 'pending', label: 'Pending', color: SERIES.s3 },
  { key: 'cancelled', label: 'Cancelled', color: SERIES.s4 },
];

function RequestsByDay({ daily, title = 'Gate pass requests by day', file }) {
  const total = daily.reduce((s, d) => s + d.requests, 0);
  return (
    <ChartCard
      title={title}
      sub={`${total} requests, by status`}
      file={file}
      empty={!total && 'No requests in this period'}
      table={{ columns: ['Date', 'Approved', 'Rejected', 'Pending', 'Cancelled', 'Total'], rows: daily.map((d) => [fmtDate(d.date), d.approved, d.rejected, d.pending, d.cancelled, d.requests]) }}
    >
      <ColumnChart data={daily} xKey="date" xLabel={dayLabel} series={STATUS_SERIES} />
    </ChartCard>
  );
}

function PurposeChart({ purpose, file }) {
  return (
    <ChartCard
      title="Requests by purpose"
      sub="Official vs personal"
      file={file}
      empty={!purpose.length && 'No requests in this period'}
      table={{ columns: ['Purpose', 'Requests', 'Approved'], rows: purpose.map((p) => [p.purpose, p.requests, p.approved]) }}
    >
      <BarList data={purpose.map((p) => ({ label: p.purpose, value: p.requests, tipLabel: 'Requests' }))} />
    </ChartCard>
  );
}

/**
 * How many gate passes each person raised in a period: this month, this year or chosen dates.
 * Its own filters, search and paging; Excel download of the whole filtered list.
 */
const PEOPLE_PRESETS = [
  ['month', 'This month'],
  ['year', 'This year'],
  ['custom', 'Dates'],
];
function peopleRange(p) {
  const now = new Date();
  if (p === 'year') return [iso(new Date(now.getFullYear(), 0, 1)), iso(now)];
  return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
}

function PeopleTable() {
  const meta = useMeta();
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(() => peopleRange('month'));
  const [f, setF] = useState({ search: '', department: '', only: '', sort: 'raised' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const query = { from: range[0], to: range[1], ...f };

  useEffect(() => {
    setErr('');
    api('/dashboard/people', { query: { ...query, page, pageSize } })
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [range[0], range[1], f.search, f.department, f.only, f.sort, page, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (k, v) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  const choose = (p) => {
    setPreset(p);
    if (p !== 'custom') setRange(peopleRange(p));
    setPage(1);
  };
  const periodText = d ? (d.from === d.to ? fmtDate(d.from) : `${fmtDate(d.from)} – ${fmtDate(d.to)}`) : '';

  return (
    <div className="card people-card">
      <div className="card-head">
        <UserRound size={18} color="var(--blue)" />
        <div style={{ minWidth: 0 }}>
          <h3>Gate passes per person</h3>
          <div className="sub">
            {d ? `${d.totals.raised} gate passes by ${d.totals.peopleRaised} people · ${periodText}` : 'Loading…'}
          </div>
        </div>
        <div className="spacer" />
        <button
          className="btn sm no-print"
          onClick={() => download('/dashboard/people', { ...query, format: 'xlsx' }, `gatepass-per-person-${range[0]}-to-${range[1]}.xlsx`).catch((e) => setErr(e.message))}
        >
          <Download size={15} /> Excel
        </button>
      </div>
      <div className="toolbar people-tools no-print">
        <Tabs value={preset} onChange={choose} items={PEOPLE_PRESETS.map(([value, label]) => ({ value, label }))} />
        {preset === 'custom' && (
          <div className="row" style={{ gap: 6 }}>
            <input className="input" type="date" value={range[0]} max={range[1]} onChange={(e) => { setRange([e.target.value, range[1]]); setPage(1); }} />
            <span className="muted small">to</span>
            <input className="input" type="date" value={range[1]} min={range[0]} max={todayISO()} onChange={(e) => { setRange([range[0], e.target.value]); setPage(1); }} />
          </div>
        )}
        <SearchBox value={f.search} onChange={(v) => setFilter('search', v)} placeholder="Search name, ID, department" />
        <select className="input" style={{ width: 'auto' }} value={f.department} onChange={(e) => setFilter('department', e.target.value)}>
          <option value="">All departments</option>
          {meta.departments.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={f.only} onChange={(e) => setFilter('only', e.target.value)}>
          <option value="">All employees</option>
          <option value="raised">Only those who raised one</option>
        </select>
        <select className="input" style={{ width: 'auto' }} value={f.sort} onChange={(e) => setFilter('sort', e.target.value)}>
          <option value="raised">Most gate passes first</option>
          <option value="name">Name A–Z</option>
          <option value="department">Department</option>
        </select>
      </div>
      {err && <div className="card-pad"><Alert type="error">{err}</Alert></div>}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th className="num">Gate passes</th>
              <th className="num">Official</th>
              <th className="num">Personal</th>
              <th className="num">Approved</th>
              <th className="num">Rejected</th>
              <th className="num">Cancelled</th>
              <th className="num">Did not return</th>
              <th>Last gate pass</th>
            </tr>
          </thead>
          <tbody>
            {d?.rows.map((r) => (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.6 }}>
                <td>
                  <b>{r.name}</b>
                  <div className="small muted">{r.emp_code}{!r.is_active && ' · inactive'}</div>
                </td>
                <td>{r.department || '—'}</td>
                <td className="num"><b>{r.raised}</b></td>
                <td className="num">{r.official}</td>
                <td className="num">{r.personal}</td>
                <td className="num">{r.approved}</td>
                <td className="num">{r.rejected}</td>
                <td className="num">{r.cancelled}</td>
                <td className="num">{r.not_returned}</td>
                <td className="nowrap">{r.last_date ? fmtDate(r.last_date) : <span className="muted">—</span>}</td>
              </tr>
            ))}
            {d && !d.rows.length && (
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 24 }}>No employees match</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {d && <Pagination page={page} pageSize={pageSize} total={d.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
    </div>
  );
}

function PlantDashboard({ d }) {
  const k = d.kpis;
  const gate = [
    { label: 'Returned (checked in)', value: k.returned },
    { label: 'Did not return', value: k.not_returned },
    { label: 'Not coming back (by plan)', value: k.not_coming_back },
  ];
  return (
    <>
      <div className="section-title"><Users size={18} /> Right now</div>
      <div className="kpis">
        <Kpi hero label="Total employees" value={d.now.employees} hint={`${d.now.presentToday} punched in today`} />
        <Kpi label="Out of plant on a gate pass" value={d.now.outNow} />
        <Kpi label="Approved, waiting to check out" value={d.now.awaitingCheckout} hint="today" />
        <Kpi label="Waiting for approval" value={d.now.pendingApproval} />
        <Kpi label="Did not return — open" value={d.now.notReturnedOpen} />
      </div>
      <div className="section-title">For {d.from === d.to ? fmtDate(d.from) : `${fmtDate(d.from)} – ${fmtDate(d.to)}`}</div>
      <div className="kpis">
        <Kpi label="Requests raised" value={k.requests} hint={`by ${k.people} employee${k.people === 1 ? '' : 's'}`} />
        <Kpi label="Approved" value={k.approved} />
        <Kpi label="Rejected" value={k.rejected} />
        <Kpi label="Checked out" value={k.checked_out} />
        <Kpi label="Returned" value={k.returned} />
        <Kpi label="Did not return" value={k.not_returned} />
        <Kpi label="Average time to decide" value={mins(k.avg_decision_min)} />
        <Kpi label="Average time outside" value={mins(k.avg_out_min)} />
      </div>
      <div className="charts">
        <RequestsByDay daily={d.daily} file="requests-by-day" />
        <ChartCard
          title="Check-outs by hour of day"
          sub="When employees leave the plant"
          file="checkouts-by-hour"
          empty={!k.checked_out && 'No check-outs in this period'}
          table={{ columns: ['Hour', 'Check-outs'], rows: d.checkoutsByHour.filter((h) => h.checkouts).map((h) => [hourLabel(h.hour, true), h.checkouts]) }}
        >
          <ColumnChart data={d.checkoutsByHour} xKey="hour" xLabel={hourLabel} labelEvery={2} series={[{ key: 'checkouts', label: 'Check-outs', color: SERIES.s1 }]} />
        </ChartCard>
        <PurposeChart purpose={d.purpose} file="requests-by-purpose" />
        <ChartCard
          title="Requests by department"
          sub="Top departments"
          file="requests-by-department"
          empty={!d.departments.length && 'No requests in this period'}
          table={{ columns: ['Department', 'Requests', 'Approved', 'Rejected'], rows: d.departments.map((x) => [x.department, x.requests, x.approved, x.rejected]) }}
        >
          <BarList data={d.departments.map((x) => ({ label: x.department, value: x.requests, tipLabel: 'Requests' }))} />
        </ChartCard>
        <ChartCard
          title="After check-out"
          sub="What happened to employees who left"
          file="after-checkout"
          empty={!k.checked_out && 'No check-outs in this period'}
          table={{ columns: ['Outcome', 'Employees'], rows: gate.map((g) => [g.label, g.value]) }}
        >
          <BarList data={gate.map((g) => ({ ...g, tipLabel: 'Employees' }))} />
        </ChartCard>
        <ChartCard title="Employees with most requests" sub="Top 10" png={false} empty={!d.topEmployees.length && 'No requests in this period'}>
          <div className="chart-table" style={{ maxHeight: 'none' }}>
            <table>
              <thead><tr><th>Employee</th><th>Requests</th><th>Approved</th><th>Did not return</th></tr></thead>
              <tbody>
                {d.topEmployees.map((e) => (
                  <tr key={e.emp_code}>
                    <td>{e.name} <span className="muted">· {e.emp_code} · {e.department}</span></td>
                    <td>{e.requests}</td>
                    <td>{e.approved}</td>
                    <td>{e.not_returned}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
      <PeopleTable />
    </>
  );
}

function MyDashboard({ d }) {
  const k = d.mine.kpis;
  const a = d.approvals;
  return (
    <>
      <div className="section-title">My gate passes</div>
      <div className="kpis">
        <Kpi hero label="Requests raised" value={k.requests} />
        <Kpi label="Approved" value={k.approved} />
        <Kpi label="Rejected" value={k.rejected} />
        <Kpi label="Pending" value={k.pending} />
        <Kpi label="Checked out" value={k.checked_out} />
        <Kpi label="Did not return" value={k.not_returned} />
        <Kpi label="Average time outside" value={mins(k.avg_out_min)} />
      </div>
      <div className="charts">
        <RequestsByDay daily={d.mine.daily} title="My requests by day" file="my-requests-by-day" />
        <PurposeChart purpose={d.mine.purpose} file="my-requests-by-purpose" />
      </div>
      {a && (
        <>
          <div className="section-title"><CheckSquare size={18} /> My approvals</div>
          <div className="kpis">
            <Kpi label="Waiting for me now" value={a.kpis.pending_now} />
            <Kpi label="Approved by me" value={a.kpis.approved_by_me} />
            <Kpi label="Rejected by me" value={a.kpis.rejected_by_me} />
            <Kpi label="Decided by another authority" value={a.kpis.decided_by_others} />
            <Kpi label="My average response" value={mins(a.kpis.avg_response_min)} />
          </div>
          <div className="charts">
            <ChartCard
              title="My decisions by day"
              file="my-decisions-by-day"
              empty={!a.daily.some((x) => x.approved || x.rejected) && 'No decisions in this period'}
              table={{ columns: ['Date', 'Approved', 'Rejected'], rows: a.daily.map((x) => [fmtDate(x.date), x.approved, x.rejected]) }}
            >
              <ColumnChart
                data={a.daily}
                xKey="date"
                xLabel={dayLabel}
                series={[
                  { key: 'approved', label: 'Approved', color: SERIES.s1 },
                  { key: 'rejected', label: 'Rejected', color: SERIES.s2 },
                ]}
              />
            </ChartCard>
            <ChartCard
              title="Requests from my team"
              sub="Employees I approve for"
              file="my-team-requests"
              empty={!a.team.length && 'No requests in this period'}
              table={{ columns: ['Employee', 'Requests', 'Approved'], rows: a.team.map((t) => [`${t.name} (${t.emp_code})`, t.requests, t.approved]) }}
            >
              <BarList data={a.team.map((t) => ({ label: t.name, value: t.requests, tipLabel: 'Requests' }))} />
            </ChartCard>
          </div>
        </>
      )}
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const plantAllowed = ['admin', 'security_admin', 'security'].includes(user.role);
  const meAllowed = user.role !== 'security';
  const [scope, setScope] = useState(plantAllowed ? 'plant' : 'me');
  const [preset, setPreset] = useState('today');
  const [custom, setCustom] = useState({ from: todayISO(), to: todayISO() });
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [from, to] = useMemo(() => (preset === 'custom' ? [custom.from, custom.to] : presetRange(preset)), [preset, custom]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api('/dashboard', { query: { scope, from, to } })
      .then((d) => alive && (setData(d), setErr('')))
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, from, to]);

  const print = () => {
    document.body.classList.add('printing-dashboard');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-dashboard'), 500);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Gate pass activity{scope === 'plant' ? ' across the plant' : ' for you'}.</p>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => download('/dashboard/export', { scope, from, to }, `gatepass-dashboard-${scope}-${from}-to-${to}.xlsx`).catch((e) => setErr(e.message))}>
          <FileSpreadsheet size={17} /> Excel
        </button>
        <button className="btn" onClick={print}><Printer size={17} /> PDF / Print</button>
      </div>

      <div className="filterbar">
        {plantAllowed && meAllowed && (
          <Tabs value={scope} onChange={setScope} items={[{ value: 'plant', label: 'Plant overview' }, { value: 'me', label: 'My dashboard' }]} />
        )}
        <Tabs value={preset} onChange={setPreset} items={PRESETS.map(([value, label]) => ({ value, label }))} />
        {preset === 'custom' && (
          <div className="row">
            <input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value || todayISO() })} title="From" />
            <span className="muted">to</span>
            <input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value || todayISO() })} title="To" />
          </div>
        )}
      </div>

      {err && <Alert type="error">{err}</Alert>}
      {data && (
        <div className="dash-print print-area" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div className="small muted" style={{ marginBottom: 10 }}>
            {data.scope === 'plant' ? 'Plant overview' : `${user.name} (${user.emp_code})`} · {data.from === data.to ? fmtDate(data.from) : `${fmtDate(data.from)} – ${fmtDate(data.to)}`} · generated {fmtDateTime(data.generatedAt)}
          </div>
          {data.scope === 'plant' ? <PlantDashboard d={data} /> : <MyDashboard d={data} />}
        </div>
      )}
    </>
  );
}
