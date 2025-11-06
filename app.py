from flask import Flask, request, Response
import pandas as pd
from io import TextIOWrapper

import calculate_pay as calc
import shift_cross_referencer as scr

app = Flask(__name__)


INDEX_HTML = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>ECP Utilities</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      h1 { margin-bottom: 8px; }
      h2 { margin-top: 28px; }
      form { border: 1px solid #e5e7eb; padding: 16px; border-radius: 8px; max-width: 720px; background: #fafafa; }
      .row { margin-bottom: 12px; }
      input[type="file"] { display:block; }
      button { background: #111827; color: white; border: none; padding: 10px 14px; border-radius: 6px; cursor: pointer; }
      button:hover { background: #0b1220; }
      .note { color: #6b7280; font-size: 13px; }
      .wrap { display: grid; grid-template-columns: 1fr; gap: 24px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #0b1220; color: #e5e7eb; padding: 16px; border-radius: 8px; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>ECP Utilities</h1>
    <div class="wrap">
      <section>
        <h2>Employee Payout Report</h2>
        <p class="note">Upload a timesheets CSV with columns: <code>employee</code>, <code>location</code>, <code>tips</code>, <code>cost</code>.</p>
        <form action="/api/calculate" method="post" enctype="multipart/form-data">
          <div class="row">
            <input type="file" name="timesheets" accept=".csv" required />
          </div>
          <button type="submit">Generate Report</button>
        </form>
      </section>

      <section>
        <h2>Missed Shifts Cross-Reference</h2>
        <p class="note">Upload scheduled-hours and timesheets CSVs with columns: <code>employee</code>, <code>date</code>, <code>location</code>. Optional: start/end time columns (various common names supported).</p>
        <form action="/api/crossref" method="post" enctype="multipart/form-data">
          <div class="row">
            <label>Scheduled-hours CSV</label>
            <input type="file" name="scheduled" accept=".csv" required />
          </div>
          <div class="row">
            <label>Timesheets CSV</label>
            <input type="file" name="timesheets" accept=".csv" required />
          </div>
          <button type="submit">Find Missed Shifts</button>
        </form>
      </section>
    </div>
  </body>
</html>
"""


@app.get("/")
def index() -> Response:
    return Response(INDEX_HTML, mimetype="text/html; charset=utf-8")


@app.post("/api/calculate")
def api_calculate() -> Response:
    if 'timesheets' not in request.files:
        return Response("Missing file field 'timesheets'", status=400)

    file = request.files['timesheets']
    if file.filename == "":
        return Response("Empty filename for 'timesheets'", status=400)

    try:
        # Pandas can read from file-like; ensure text mode
        # werkzeug provides a binary stream; TextIOWrapper handles decoding
        text_stream = TextIOWrapper(file.stream, encoding='utf-8', errors='ignore')
        df = pd.read_csv(text_stream, usecols=calc.COLUMNS_TO_USE)

        final_report = calc.calculate_payout_report_from_df(df)

        # Format currency columns for display
        final_report_disp = final_report.copy()
        final_report_disp['TotalAmountOwed'] = final_report_disp['TotalAmountOwed'].map('${:,.2f}'.format)
        final_report_disp['AverageOwedPerShift'] = final_report_disp['AverageOwedPerShift'].map('${:,.2f}'.format)

        lines = ["--- Employee Payout Report ---", "", final_report_disp.to_string(index=False), "", "Calculation complete."]
        html = "<pre>" + ("\n".join(lines)) + "</pre><p><a href='/'>&larr; Back</a></p>"
        return Response(html, mimetype="text/html; charset=utf-8")
    except Exception as exc:
        return Response(f"Error processing file: {exc}", status=400)


@app.post("/api/crossref")
def api_crossref() -> Response:
    if 'scheduled' not in request.files or 'timesheets' not in request.files:
        return Response("Expected file fields 'scheduled' and 'timesheets'", status=400)

    f_sched = request.files['scheduled']
    f_time = request.files['timesheets']
    if f_sched.filename == "" or f_time.filename == "":
        return Response("One or more files have empty filenames", status=400)

    try:
        sched_stream = TextIOWrapper(f_sched.stream, encoding='utf-8', errors='ignore')
        time_stream = TextIOWrapper(f_time.stream, encoding='utf-8', errors='ignore')
        df_scheduled = pd.read_csv(sched_stream)
        df_timesheets = pd.read_csv(time_stream)

        missed_by_employee, missed_count = scr.find_missed_shifts_from_dfs(df_scheduled, df_timesheets)

        if missed_count == 0:
            body = "All scheduled shifts appear to have a corresponding timesheet entry."
            html = "<pre>" + body + "</pre><p><a href='/'>&larr; Back</a></p>"
            return Response(html, mimetype="text/html; charset=utf-8")

        lines = ["--- Missed Shifts ---", ""]
        for employee in sorted(missed_by_employee.keys()):
            lines.append(f"Employee: {employee}")
            for s in missed_by_employee[employee]:
                if 'start' in s and 'end' in s:
                    lines.append(f"  - {s['date']} — {s['location']} (Scheduled: {s['start']} - {s['end']})")
                else:
                    lines.append(f"  - {s['date']} — {s['location']}")
            lines.append("-" * 30)
        lines.append(f"Found a total of {missed_count} missed shifts across {len(missed_by_employee)} employee(s).")

        html = "<pre>" + ("\n".join(lines)) + "</pre><p><a href='/'>&larr; Back</a></p>"
        return Response(html, mimetype="text/html; charset=utf-8")
    except Exception as exc:
        return Response(f"Error processing files: {exc}", status=400)


if __name__ == "__main__":
    # Local dev server
    app.run(host="0.0.0.0", port=5000, debug=True)


