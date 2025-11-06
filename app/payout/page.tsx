export default function PayoutPage() {
  return (
    <main>
      <h1 style={{ margin: 0, marginBottom: 8 }}>Payout Report</h1>
      <p style={{ color: '#374151', marginBottom: 12 }}>
        Upload the timesheets CSV to generate the payout report.
      </p>
      <form action="/api/calculate" method="post" encType="multipart/form-data" style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Timesheets CSV</span>
          <input type="file" name="timesheets" accept=".csv,text/csv" required />
        </label>
        <button type="submit" style={{ background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
          Generate Report
        </button>
      </form>
    </main>
  );
}


