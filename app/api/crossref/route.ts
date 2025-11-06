import { csvParse } from 'd3-dsv';

type AnyRow = Record<string, unknown>;

const KEY_COLUMNS = ['employee', 'date', 'location'] as const;

const IGNORED_EMPLOYEES = new Set([
  'Luke Whelan',
  'Tony',
  'Arod',
  'Danny M',
  'Aquib',
  'Nick C',
  'Andy',
  'Troy',
  'Rony',
  'Alexander M Kiwowicz',
  'Michael C',
  'Jay',
  'Dave',
  'Nick T',
].map(s => s.toLowerCase()));

const IGNORED_LOCATIONS = new Set([
  'Blu on the Hudson',
  "Ruth's Chris",
  'Haven',
  'Chart House',
  "Fleming's Edgewater",
].map(s => s.toLowerCase()));

const SCHEDULED_START_CANDIDATES = [
  'start_time', 'start time', 'start', 'scheduled_start', 'scheduled start', 'shift start',
];
const SCHEDULED_END_CANDIDATES = [
  'end_time', 'end time', 'end', 'scheduled_end', 'scheduled end', 'shift end',
];

function normalizeRowKeys(input: AnyRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.trim().toLowerCase()] = (v ?? '').toString().trim();
  }
  return out;
}

function findFirstExistingColumn(row: Record<string, string>, candidates: string[]): string | null {
  for (const cand of candidates) {
    if (cand in row) return cand;
  }
  return null;
}

function keyOf(r: Record<string, string>): string {
  return `${r['employee']}||${r['date']}||${r['location']}`;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const fScheduled = form.get('scheduled');
    const fTimesheets = form.get('timesheets');
    if (!(fScheduled instanceof File) || !(fTimesheets instanceof File)) {
      return new Response("Expected file fields 'scheduled' and 'timesheets'", { status: 400 });
    }

    const [schedText, timeText] = await Promise.all([fScheduled.text(), fTimesheets.text()]);
    const scheduledParsed = csvParse(schedText) as unknown as AnyRow[];
    const timesheetsParsed = csvParse(timeText) as unknown as AnyRow[];

    const scheduledRows = scheduledParsed.map(r => normalizeRowKeys(r));
    const timesheetRows = timesheetsParsed.map(r => normalizeRowKeys(r));

    // Filter out ignored employees and locations (case-insensitive)
    const filteredScheduled = scheduledRows.filter(r =>
      (!r['employee'] || !IGNORED_EMPLOYEES.has(r['employee'].toLowerCase())) &&
      (!r['location'] || !IGNORED_LOCATIONS.has(r['location'].toLowerCase()))
    );
    const filteredTimesheets = timesheetRows.filter(r =>
      (!r['employee'] || !IGNORED_EMPLOYEES.has(r['employee'].toLowerCase())) &&
      (!r['location'] || !IGNORED_LOCATIONS.has(r['location'].toLowerCase()))
    );

    // Detect optional start/end columns on scheduled file
    const startCol = filteredScheduled.length > 0 ? findFirstExistingColumn(filteredScheduled[0], SCHEDULED_START_CANDIDATES) : null;
    const endCol = filteredScheduled.length > 0 ? findFirstExistingColumn(filteredScheduled[0], SCHEDULED_END_CANDIDATES) : null;

    // Set of unique worked shifts
    const workedSet = new Set(
      filteredTimesheets
        .filter(r => KEY_COLUMNS.every(k => r[k]))
        .map(r => keyOf(r))
    );

    let missedCount = 0;
    const missedByEmployee = new Map<string, Array<Record<string, string>>>();

    for (const r of filteredScheduled) {
      if (!KEY_COLUMNS.every(k => r[k])) continue;
      if (!workedSet.has(keyOf(r))) {
        missedCount += 1;
        const entry: Record<string, string> = {
          date: r['date'],
          location: r['location'],
        };
        if (startCol && endCol) {
          entry['start'] = r[startCol];
          entry['end'] = r[endCol];
        }
        const emp = r['employee'];
        const list = missedByEmployee.get(emp) ?? [];
        list.push(entry);
        missedByEmployee.set(emp, list);
      }
    }

    if (missedCount === 0) {
      const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Missed Shifts</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      .card { border: 1px solid #e5e7eb; background: #fff; border-radius: 8px; padding: 16px; max-width: 840px; }
      .muted { color: #6b7280; }
      a.button { background: #111827; color: #fff; text-decoration: none; padding: 10px 14px; border-radius: 6px; display: inline-block; margin-top: 12px; }
    </style>
  </head>
  <body>
    <h1 style="margin:0 0 8px">Missed Shifts</h1>
    <div class="card">
      <p class="muted">All scheduled shifts appear to have a corresponding timesheet entry.</p>
      <a href="/missed-shifts" class="button">⟵ Back to Missed Shifts</a>
    </div>
  </body>
</html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const employees = Array.from(missedByEmployee.keys()).sort((a, b) => a.localeCompare(b));
    const rowsHtml = employees.map(emp => {
      const entries = (missedByEmployee.get(emp) ?? []).map(s => {
        const sched = 'start' in s && 'end' in s ? `${s['start']} - ${s['end']}` : '';
        return `<tr>
          <td>${emp}</td>
          <td>${s['date']}</td>
          <td>${s['location']}</td>
          <td>${sched}</td>
        </tr>`;
      }).join('');
      return entries;
    }).join('');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Missed Shifts</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      h1 { margin: 0 0 8px; }
      .summary { margin: 8px 0 16px; color: #374151; }
      table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #e5e7eb; max-width: 980px; }
      thead th { text-align: left; background: #f9fafb; font-weight: 600; color: #111827; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
      tbody td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }
      tbody tr:hover { background: #fafafa; }
      a.button { background: #111827; color: #fff; text-decoration: none; padding: 10px 14px; border-radius: 6px; display: inline-block; margin-top: 16px; }
    </style>
  </head>
  <body>
    <h1>Missed Shifts</h1>
    <div class="summary">
      <div>Total missed shifts: <strong>${missedCount}</strong></div>
      <div>Employees with missed shifts: <strong>${employees.length}</strong></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Employee</th>
          <th>Date</th>
          <th>Location</th>
          <th>Scheduled</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <a href="/missed-shifts" class="button">⟵ Back to Missed Shifts</a>
  </body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (err: any) {
    return new Response(`Error processing files: ${err?.message ?? String(err)}`, { status: 400 });
  }
}


