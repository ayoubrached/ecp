from flask import Flask, request, Response
from io import TextIOWrapper
import os
import sys
import pandas as pd

# Ensure project root is importable
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import calculate_pay as calc

app = Flask(__name__)


@app.post("/")
@app.post("/api/calculate")
def handle() -> Response:
    if 'timesheets' not in request.files:
        return Response("Missing file field 'timesheets'", status=400)

    file = request.files['timesheets']
    if file.filename == "":
        return Response("Empty filename for 'timesheets'", status=400)

    try:
        text_stream = TextIOWrapper(file.stream, encoding='utf-8', errors='ignore')
        df = pd.read_csv(text_stream, usecols=calc.COLUMNS_TO_USE)

        final_report = calc.calculate_payout_report_from_df(df)

        # Format the currency columns for display
        final_report_disp = final_report.copy()
        final_report_disp['TotalAmountOwed'] = final_report_disp['TotalAmountOwed'].map('${:,.2f}'.format)
        final_report_disp['AverageOwedPerShift'] = final_report_disp['AverageOwedPerShift'].map('${:,.2f}'.format)

        lines = ["--- Employee Payout Report ---", "", final_report_disp.to_string(index=False), "", "Calculation complete."]
        html = "<pre>" + ("\n".join(lines)) + "</pre><p><a href='/'>&larr; Back</a></p>"
        return Response(html, mimetype="text/html; charset=utf-8")
    except Exception as exc:
        return Response(f"Error processing file: {exc}", status=400)


