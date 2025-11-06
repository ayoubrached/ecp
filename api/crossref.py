from flask import Flask, request, Response
from io import TextIOWrapper
import os
import sys
import pandas as pd

# Ensure project root is importable
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import shift_cross_referencer as scr

app = Flask(__name__)


@app.post("/")
@app.post("/api/crossref")
def handle() -> Response:
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





