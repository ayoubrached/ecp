export default function MissedShiftsPage() {
  return (
    <main>
      <h1 style={{ margin: 0, marginBottom: 8 }}>Missed Shifts</h1>
      <p style={{ color: '#374151', marginBottom: 12 }}>
        Upload the scheduled and timesheets CSVs to find scheduled shifts with no timesheet entry.
      </p>
      <form action="/api/crossref" method="post" encType="multipart/form-data" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Scheduled CSV</span>
          <input type="file" name="scheduled" accept=".csv,text/csv" required />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Timesheets CSV</span>
          <input type="file" name="timesheets" accept=".csv,text/csv" required />
        </label>
        <button type="submit" style={{ background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 6, border: 0, cursor: 'pointer' }}>
          Compare Files
        </button>
      </form>
    </main>
  );
}


