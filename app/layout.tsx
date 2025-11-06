export const metadata = {
  title: "ECP Utilities",
  description: "Upload CSVs to run payout and missed-shift reports",
};

import Link from 'next/link';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning style={{ margin: 24, fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif", color: "#111" }}>
        <nav style={{ display: 'flex', gap: 12, alignItems: 'center', paddingBottom: 12, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <Link href="/payout" style={{ color: '#111', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, background: '#f3f4f6' }}>Payout Report</Link>
          <Link href="/payout/locations" style={{ color: '#111', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, background: '#f3f4f6' }}>Payout by Location</Link>
          <Link href="/missed-shifts" style={{ color: '#111', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, background: '#f3f4f6' }}>Missed Shifts</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}


