import { csvParse } from 'd3-dsv';

type TimesheetRow = {
  employee: string;
  location: string;
  tips: string | number;
  cost: string | number;
  [key: string]: unknown;
};

const EXCLUDED_LOCATIONS = new Set([
  'Blu on the Hudson',
  'Chart House',
  'Haven',
  "Ruth's Chris",
]);

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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

    // Normalize rows and pick required columns by case-insensitive names
    const rows = parsed.map(r => normalizeRowKeys(r as unknown as Record<string, unknown>));

    // Step 1: filtering
    const filtered = rows.filter(r => {
      const employee = (r['employee'] ?? '').toString().trim();
      const location = (r['location'] ?? '').toString().trim();
      if (!employee) return false;
      if (EXCLUDED_EMPLOYEES.has(employee)) return false;
      if (EXCLUDED_LOCATIONS.has(location)) return false;
      return true;
    }).map(r => ({
      employee: (r['employee'] ?? '').toString().trim(),
      location: (r['location'] ?? '').toString().trim(),
      tips: cleanCurrency(r['tips'] ?? 0),
      cost: cleanCurrency(r['cost'] ?? 0),
    }));

    // Step 2: bonus
    const withBonus = filtered.map(row => ({
      ...row,
      bonus: row.location === "Fleming's Condo" && row.cost > row.tips ? 13.5 : 0,
    }));

    // Step 3: source where cost > tips
    const source = withBonus.filter(r => r.cost > r.tips).map(r => ({
      ...r,
      amount_owed: r.cost - r.tips + r.bonus,
    }));

    // Step 4: group by employee
    const byEmployee = new Map<string, { total: number; count: number }>();
    for (const r of source) {
      const cur = byEmployee.get(r.employee) ?? { total: 0, count: 0 };
      cur.total += r.amount_owed;
      cur.count += 1;
      byEmployee.set(r.employee, cur);
    }

    const summaryRows = Array.from(byEmployee.entries())
      .map(([employee, agg]) => ({
        Employee: employee,
        TotalAmountOwed: agg.total,
        ShiftsThatWereOwed: agg.count,
        AverageOwedPerShift: agg.count > 0 ? agg.total / agg.count : 0,
      }));

    // Default sort by Employee ascending
    summaryRows.sort((a, b) => a.Employee.localeCompare(b.Employee));

    // Totals
    const totalAmount = source.reduce((s, r) => s + r.amount_owed, 0);
    const totalShifts = source.length;
    const totalAvg = totalShifts > 0 ? totalAmount / totalShifts : 0;

    // Build HTML with styling and client-side sorting
    const rowsHtml = summaryRows.map(r => `
          <tr data-employee="${escapeHtml(r.Employee)}" data-total="${r.TotalAmountOwed}" data-shifts="${r.ShiftsThatWereOwed}" data-average="${r.AverageOwedPerShift}">
            <td>${escapeHtml(r.Employee)}</td>
            <td>${formatCurrency(r.TotalAmountOwed)}</td>
            <td>${r.ShiftsThatWereOwed}</td>
            <td>${formatCurrency(r.AverageOwedPerShift)}</td>
          </tr>
        `).join('');

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Employee Payout Report</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #e5e7eb; background: #0b1220; }
      .wrap { max-width: 1100px; margin: 0 auto; }
      h1 { margin: 0 0 8px; color: #f3f4f6; }
      /* header sort buttons */
      th .th-btn { all: unset; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: #111827; font-weight: 600; }
      th .th-btn .arrow { font-size: 11px; opacity: 0.6; }
      th .th-btn.active .arrow { opacity: 1; }
      th .th-btn:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; border-radius: 4px; }
      a.button { background: #2563eb; color: #fff; text-decoration: none; padding: 8px 12px; border-radius: 8px; display: inline-block; font-weight: 600; }
      a.button:hover { background: #1d4ed8; }
      a.button.secondary { background: #374151; }
      a.button.secondary:hover { background: #4b5563; }
      .muted { color: #cbd5e1; font-size: 13px; }
      .summary { margin: 8px 0 14px; }
      .summaryGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .metric { background: #0f172a; border: 1px solid #1f2937; border-radius: 10px; padding: 10px 12px; }
      .metric .label { color: #cbd5e1; font-size: 12px; margin-bottom: 4px; }
      .metric .value { color: #f9fafb; font-weight: 700; font-size: 16px; }
      .card { background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.25; }
      thead th { position: sticky; top: 0; text-align: left; background: #f3f4f6; font-weight: 600; color: #111827; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
      tbody td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; color: #111827; }
      tbody tr:hover { background: #fafafa; }
      tfoot td { padding: 8px 10px; font-weight: 600; background: #f3f4f6; color: #111827; }
      /* Right-align numeric columns */
      thead th:nth-child(2), thead th:nth-child(3), thead th:nth-child(4),
      tbody td:nth-child(2), tbody td:nth-child(3), tbody td:nth-child(4),
      tfoot td:nth-child(2), tfoot td:nth-child(3), tfoot td:nth-child(4) { text-align: right; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Employee Payout Report</h1>
      <div style="display:flex; justify-content:flex-end; margin: 6px 0 10px;">
        <a href="/payout" class="button secondary">⟵ Back to Payout</a>
      </div>
      <p id="sortStatus" class="muted">Sorted by <strong>Employee</strong> (ascending). Click a column header to sort; click again to toggle order.</p>

      <div class="summary">
        <div class="summaryGrid">
          <div class="metric">
            <div class="label">Total owed across all shifts</div>
            <div class="value">${formatCurrency(totalAmount)}</div>
          </div>
          <div class="metric">
            <div class="label">Total shifts that were owed</div>
            <div class="value">${totalShifts}</div>
          </div>
          <div class="metric">
            <div class="label">Average owed per owed shift</div>
            <div class="value">${formatCurrency(totalAvg)}</div>
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
          <td>${formatCurrency(totalAmount)}</td>
          <td>${totalShifts}</td>
          <td>${formatCurrency(totalAvg)}</td>
        </tr>
      </tfoot>
        </table>
      </div>

      <script>
      (function() {
        const tbody = document.querySelector('#reportTable tbody');
        const headerButtons = Array.from(document.querySelectorAll('th .th-btn'));
        const statusEl = document.getElementById('sortStatus');
        const displayName = { employee: 'Employee', total: 'TotalAmountOwed', shifts: 'ShiftsThatWereOwed', average: 'AverageOwedPerShift' };
        let currentKey = 'employee';
        let currentDir = 'asc';

        function cmp(a, b, key, dir) {
          let av = a.dataset[key];
          let bv = b.dataset[key];
          if (key === 'total' || key === 'shifts' || key === 'average') {
            av = Number(av);
            bv = Number(bv);
          }
          if (key === 'employee') {
            const res = String(av).localeCompare(String(bv));
            return dir === 'asc' ? res : -res;
          }
          const res = (Number(av) - Number(bv));
          return dir === 'asc' ? res : -res;
        }

        function applySort() {
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort((ra, rb) => cmp(ra, rb, currentKey, currentDir));
          rows.forEach(r => tbody.appendChild(r));
        }

        function updateArrows() {
          headerButtons.forEach(btn => {
            const arrow = btn.querySelector('.arrow');
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

        headerButtons.forEach(btn => {
          btn.addEventListener('click', function() {
            const key = this.dataset.key;
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

        // Initialize indicators
        updateArrows();
      })();
      </script>
    </div>
  </body>
</html>`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: any) {
    return new Response(`Error processing file: ${err?.message ?? String(err)}` , { status: 400 });
  }
}


