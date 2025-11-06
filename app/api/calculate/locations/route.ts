import { csvParse } from 'd3-dsv';

type TimesheetRow = Record<string, unknown>;

const EXCLUDED_EMPLOYEES = new Set([
  'Nick C',
  'Troy',
  'Andy',
  'Arod',
  'Danny M',
  'Jay',
  'Totals',
  '',
]);

function normalizeRowKeys(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k.trim().toLowerCase()] = (v ?? '').toString().trim();
  }
  return out;
}

function cleanCurrency(value: string | number): number {
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[$,\s]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toJs(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get('timesheets');
    if (!(file instanceof File)) {
      return new Response("Missing file field 'timesheets'", { status: 400 });
    }

    const csvText = await file.text();
    const parsed = csvParse(csvText) as unknown as TimesheetRow[];

    const rows = parsed.map(r => normalizeRowKeys(r as unknown as Record<string, unknown>));

    // Filter employees only (no location exclusions). All locations included initially.
    const filtered = rows.filter(r => {
      const employee = (r['employee'] ?? '').toString().trim();
      const location = (r['location'] ?? '').toString().trim();
      if (!employee) return false;
      if (EXCLUDED_EMPLOYEES.has(employee)) return false;
      return true;
    }).map(r => ({
      employee: (r['employee'] ?? '').toString().trim(),
      location: (r['location'] ?? '').toString().trim(),
      tips: cleanCurrency(r['tips'] ?? 0),
      cost: cleanCurrency(r['cost'] ?? 0),
    }));

    // Bonus logic stays the same
    const withBonus = filtered.map(row => ({
      ...row,
      bonus: row.location === "Fleming's Condo" && row.cost > row.tips ? 13.5 : 0,
    }));

    const source = withBonus.filter(r => r.cost > r.tips).map(r => ({
      ...r,
      amount_owed: r.cost - r.tips + r.bonus,
    }));

    // Build client data: owed rows by employee and location for dynamic filtering
    const clientRows = source.map(r => ({ employee: r.employee, location: r.location, amountOwed: r.amount_owed }));
    const allLocations = Array.from(new Set(clientRows.map(r => r.location))).sort((a, b) => a.localeCompare(b));

    // Initial totals across all locations
    const initialAgg = new Map<string, { total: number; count: number }>();
    for (const r of clientRows) {
      const cur = initialAgg.get(r.employee) ?? { total: 0, count: 0 };
      cur.total += r.amountOwed;
      cur.count += 1;
      initialAgg.set(r.employee, cur);
    }
    const summaryRows = Array.from(initialAgg.entries()).map(([employee, agg]) => ({
      Employee: employee,
      TotalAmountOwed: agg.total,
      ShiftsThatWereOwed: agg.count,
      AverageOwedPerShift: agg.count > 0 ? agg.total / agg.count : 0,
    })).sort((a, b) => a.Employee.localeCompare(b.Employee));

    const totalAmount = clientRows.reduce((s, r) => s + r.amountOwed, 0);
    const totalShifts = clientRows.length;
    const totalAvg = totalShifts > 0 ? totalAmount / totalShifts : 0;

    const rowsHtml = summaryRows.map(r => `
          <tr data-employee="${escapeHtml(r.Employee)}" data-total="${r.TotalAmountOwed}" data-shifts="${r.ShiftsThatWereOwed}" data-average="${r.AverageOwedPerShift}">
            <td>${escapeHtml(r.Employee)}</td>
            <td>${formatCurrency(r.TotalAmountOwed)}</td>
            <td>${r.ShiftsThatWereOwed}</td>
            <td>${formatCurrency(r.AverageOwedPerShift)}</td>
          </tr>
        `).join('');

    const dataRowsJs = toJs(clientRows);
    const dataLocJs = toJs(allLocations);

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Employee Payout — By Location</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #e5e7eb; background: #0b1220; }
      .wrap { max-width: 1100px; margin: 0 auto; }
      h1 { margin: 0 0 8px; color: #f3f4f6; }
      .muted { color: #cbd5e1; font-size: 13px; }
      a.button { background: #374151; color: #fff; text-decoration: none; padding: 8px 12px; border-radius: 8px; display: inline-block; font-weight: 600; }
      a.button:hover { background: #4b5563; }
      .summary { margin: 8px 0 14px; }
      .summaryGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .metric { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; padding: 10px 12px; }
      .metric .label { color: #cbd5e1; font-size: 12px; margin-bottom: 4px; }
      .metric .value { color: #f9fafb; font-weight: 700; font-size: 16px; }
      .filters { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .locbar { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin-bottom: 12px; }
      .loclist { display: flex; gap: 8px; flex-wrap: wrap; max-height: 140px; overflow: auto; padding: 8px; background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; }
      .loc { display: inline-flex; align-items: center; gap: 6px; color: #e5e7eb; background: #111827; border: 1px solid #374151; border-radius: 999px; padding: 4px 10px; font-size: 12px; }
      .loc input { accent-color: #2563eb; }
      .chip { display: inline-block; background: #111827; border: 1px solid #374151; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: #e5e7eb; }
      .card { background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.25; }
      thead th { position: sticky; top: 0; text-align: left; background: #f3f4f6; font-weight: 600; color: #111827; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
      thead th .th-btn { all: unset; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #111827; font-weight: 600; }
      thead th .th-btn .arrow { font-size: 11px; opacity: 0.6; }
      thead th .th-btn.active .arrow { opacity: 1; }
      thead th .th-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; border-radius: 4px; }
      tbody td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; color: #111827; }
      tbody tr:hover { background: #fafafa; }
      tfoot td { padding: 8px 10px; font-weight: 600; background: #f3f4f6; color: #111827; }
      thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4),
      tbody td:nth-child(2), tbody td:nth-child(3), tbody td:nth-child(4),
      tfoot td:nth-child(2), tfoot td:nth-child(3), tfoot td:nth-child(4) { text-align: right; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Employee Payout — By Location</h1>
      <div style="display:flex; justify-content:space-between; align-items:center; margin: 6px 0 10px;">
        <p id="sortStatus" class="muted" style="margin:0;">Sorted by <strong>Employee</strong> (ascending). Click a column header to sort; click again to toggle order.</p>
        <a href="/payout/locations" class="button">⟵ Back</a>
      </div>

      <div class="locbar">
        <div>
          <div class="muted" style="margin-bottom:6px">Filter locations (applies immediately):</div>
          <div id="locList" class="loclist"></div>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; align-items:start;">
          <a href="#" class="button" id="locAll">Select All</a>
          <a href="#" class="button" id="locNone">Clear</a>
        </div>
      </div>

      <div class="summary">
        <div class="summaryGrid">
          <div class="metric">
            <div class="label">Total owed across all shifts</div>
            <div class="value" id="sumTotal">${formatCurrency(totalAmount)}</div>
          </div>
          <div class="metric">
            <div class="label">Total shifts that were owed</div>
            <div class="value" id="sumShifts">${totalShifts}</div>
          </div>
          <div class="metric">
            <div class="label">Average owed per owed shift</div>
            <div class="value" id="sumAvg">${formatCurrency(totalAvg)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <table id="reportTable">
          <thead>
            <tr>
              <th><button class="th-btn" data-key="employee">Employee <span class="arrow">↕</span></button></th>
              <th><button class="th-btn" data-key="total">TotalAmountOwed <span class="arrow">↕</span></button></th>
              <th><button class="th-btn" data-key="shifts">ShiftsThatWereOwed <span class="arrow">↕</span></button></th>
              <th><button class="th-btn" data-key="average">AverageOwedPerShift <span class="arrow">↕</span></button></th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td id="ftTotal">${formatCurrency(totalAmount)}</td>
              <td id="ftShifts">${totalShifts}</td>
              <td id="ftAvg">${formatCurrency(totalAvg)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <script>
      (function() {
        function hs(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;'); }
        function usd(n){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0); }

        var DATA_ROWS = ${dataRowsJs};
        var DATA_LOCATIONS = ${dataLocJs};

        var tbody = document.querySelector('#reportTable tbody');
        var headerButtons = Array.from(document.querySelectorAll('th .th-btn'));
        var statusEl = document.getElementById('sortStatus');
        var displayName = { employee: 'Employee', total: 'TotalAmountOwed', shifts: 'ShiftsThatWereOwed', average: 'AverageOwedPerShift' };
        var currentKey = 'employee';
        var currentDir = 'asc';
        var locList = document.getElementById('locList');
        var btnAll = document.getElementById('locAll');
        var btnNone = document.getElementById('locNone');
        var ftTotal = document.getElementById('ftTotal');
        var ftShifts = document.getElementById('ftShifts');
        var ftAvg = document.getElementById('ftAvg');
        var sumTotal = document.getElementById('sumTotal');
        var sumShifts = document.getElementById('sumShifts');
        var sumAvg = document.getElementById('sumAvg');

        function cmp(a, b, key, dir) {
          var av = a.dataset[key];
          var bv = b.dataset[key];
          if (key === 'total' || key === 'shifts' || key === 'average') {
            av = Number(av);
            bv = Number(bv);
          }
          if (key === 'employee') {
            var res = String(av).localeCompare(String(bv));
            return dir === 'asc' ? res : -res;
          }
          var resNum = (Number(av) - Number(bv));
          return dir === 'asc' ? resNum : -resNum;
        }

        function applySort() {
          var rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort(function(ra, rb){ return cmp(ra, rb, currentKey, currentDir); });
          rows.forEach(function(r){ tbody.appendChild(r); });
        }

        function updateArrows() {
          headerButtons.forEach(function(btn){
            var arrow = btn.querySelector('.arrow');
            btn.classList.toggle('active', btn.dataset.key === currentKey);
            if (btn.dataset.key === currentKey) {
              arrow.textContent = currentDir === 'asc' ? '▲' : '▼';
            } else {
              arrow.textContent = '↕';
            }
          });
          if (statusEl) {
            statusEl.innerHTML = 'Sorted by <strong>' + displayName[currentKey] + '</strong> (' + (currentDir === 'asc' ? 'ascending' : 'descending') + '). Click a column header to sort; click again to toggle order.';
          }
        }

        function selectedLocations(){
          var set = new Set();
          Array.from(document.querySelectorAll('.loc-cb')).forEach(function(cb){ if (cb.checked) set.add(cb.value.toLowerCase()); });
          return set;
        }

        function renderLocationControls(){
          var html = '';
          DATA_LOCATIONS.forEach(function(loc){
            html += '<label class="loc"><input type="checkbox" class="loc-cb" value="' + hs(loc) + '" checked> <span>' + hs(loc) + '</span></label>';
          });
          locList.innerHTML = html;
          Array.from(document.querySelectorAll('.loc-cb')).forEach(function(cb){
            cb.addEventListener('change', function(){ recompute(); });
          });
        }

        function recompute(){
          var sel = selectedLocations();
          var agg = Object.create(null);
          var totAmount = 0; var totShifts = 0;
          DATA_ROWS.forEach(function(r){
            if (!sel.has(String(r.location).toLowerCase())) return;
            totAmount += Number(r.amountOwed) || 0;
            totShifts += 1;
            var emp = String(r.employee);
            var a = agg[emp];
            if (!a) { a = { total:0, count:0 }; agg[emp] = a; }
            a.total += Number(r.amountOwed) || 0;
            a.count += 1;
          });
          var summary = Object.keys(agg).map(function(emp){
            var a = agg[emp];
            return { Employee: emp, TotalAmountOwed: a.total, ShiftsThatWereOwed: a.count, AverageOwedPerShift: a.count > 0 ? a.total / a.count : 0 };
          });
          summary.sort(function(a,b){ return a.Employee.localeCompare(b.Employee); });

          var html = '';
          summary.forEach(function(r){
            html += '<tr data-employee="' + hs(r.Employee) + '" data-total="' + r.TotalAmountOwed + '" data-shifts="' + r.ShiftsThatWereOwed + '" data-average="' + r.AverageOwedPerShift + '">\
<td>' + hs(r.Employee) + '</td>\
<td>' + usd(r.TotalAmountOwed) + '</td>\
<td>' + r.ShiftsThatWereOwed + '</td>\
<td>' + usd(r.AverageOwedPerShift) + '</td>\
</tr>';
          });
          tbody.innerHTML = html;
          applySort();
          ftTotal.textContent = usd(totAmount);
          ftShifts.textContent = String(totShifts);
          ftAvg.textContent = usd(totAmount && totShifts ? (totAmount / totShifts) : 0);
          sumTotal.textContent = usd(totAmount);
          sumShifts.textContent = String(totShifts);
          sumAvg.textContent = usd(totAmount && totShifts ? (totAmount / totShifts) : 0);
        }

        headerButtons.forEach(function(btn){
          btn.addEventListener('click', function(){
            var key = this.dataset.key;
            if (key === currentKey) {
              currentDir = currentDir === 'asc' ? 'desc' : 'asc';
            } else {
              currentKey = key;
              currentDir = 'asc';
            }
            applySort();
            updateArrows();
          });
        });

        if (btnAll) btnAll.addEventListener('click', function(e){ e.preventDefault(); Array.from(document.querySelectorAll('.loc-cb')).forEach(function(cb){ cb.checked = true; }); recompute(); });
        if (btnNone) btnNone.addEventListener('click', function(e){ e.preventDefault(); Array.from(document.querySelectorAll('.loc-cb')).forEach(function(cb){ cb.checked = false; }); recompute(); });

        renderLocationControls();
        updateArrows();
        // Initial recompute to normalize formatting and state
        recompute();
      })();
      </script>
    </div>
  </body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: any) {
    return new Response(`Error processing file: ${err?.message ?? String(err)}`, { status: 400 });
  }
}


