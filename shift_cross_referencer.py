import pandas as pd
import os

def find_latest_csv_by_prefix(prefix):
    """Return the most recently modified CSV whose filename starts with prefix (case-insensitive)."""
    prefix_lower = prefix.lower()
    candidates = []
    for name in os.listdir('.'):
        lower = name.lower()
        if lower.startswith(prefix_lower) and lower.endswith('.csv'):
            path = os.path.join('.', name)
            candidates.append(path)
    if not candidates:
        raise FileNotFoundError(f"No CSV files found starting with '{prefix}'.")
    candidates.sort(key=lambda p: os.path.getmtime(p))
    return candidates[-1]
from collections import defaultdict

# --- Configuration ---
# Optional file path overrides via environment; otherwise resolved at runtime when needed
SCHEDULED_FILE = os.environ.get("SCHEDULED_FILE")
TIMESHEET_FILE = os.environ.get("TIMESHEET_FILE")

# Define the columns that uniquely identify a shift
# We use Employee, Date, and Location
KEY_COLUMNS = ['employee', 'date', 'location']
# ---------------------

def strip_whitespace(value):
    """Helper function to remove leading/trailing whitespace from a cell."""
    if isinstance(value, str):
        return value.strip()
    return value

def find_first_existing_column(df, candidates):
    """Return the first matching column from candidates (case-insensitive), or None."""
    mapping = {c.lower().strip(): c for c in df.columns}
    for cand in candidates:
        key = cand.lower().strip()
        if key in mapping:
            return mapping[key]
    return None

# Optional column candidates for scheduled start/end times (common variations)
SCHEDULED_START_CANDIDATES = [
    'start_time', 'start time', 'start', 'scheduled_start', 'scheduled start', 'shift start',
]
SCHEDULED_END_CANDIDATES = [
    'end_time', 'end time', 'end', 'scheduled_end', 'scheduled end', 'shift end',
]

# Employees to ignore entirely (case-insensitive match)
IGNORED_EMPLOYEES = {
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
}

# Locations to ignore entirely (case-insensitive match)
IGNORED_LOCATIONS = {
    'Blu on the Hudson',
    "Ruth's Chris",
    'Haven',
    'Chart House',
    "Fleming's Edgewater",
}

def find_missed_shifts_from_dfs(df_scheduled: pd.DataFrame, df_timesheets: pd.DataFrame):
    """
    Core logic extracted to operate on in-memory DataFrames.
    Returns (missed_by_employee: dict[str, list[dict]], missed_shifts_count: int).
    """
    # Normalize key columns by stripping whitespace
    for col in KEY_COLUMNS:
        if col in df_scheduled.columns:
            df_scheduled[col] = df_scheduled[col].apply(strip_whitespace)
        if col in df_timesheets.columns:
            df_timesheets[col] = df_timesheets[col].apply(strip_whitespace)

    # Filter out ignored employees and locations (case-insensitive)
    ignored_lower = {name.lower() for name in IGNORED_EMPLOYEES}
    ignored_locations_lower = {loc.lower() for loc in IGNORED_LOCATIONS}

    if 'employee' in df_scheduled.columns:
        df_scheduled = df_scheduled[
            ~df_scheduled['employee'].astype(str).str.lower().isin(ignored_lower)
        ]
    if 'employee' in df_timesheets.columns:
        df_timesheets = df_timesheets[
            ~df_timesheets['employee'].astype(str).str.lower().isin(ignored_lower)
        ]

    if 'location' in df_scheduled.columns:
        df_scheduled = df_scheduled[
            ~df_scheduled['location'].astype(str).str.lower().isin(ignored_locations_lower)
        ]
    if 'location' in df_timesheets.columns:
        df_timesheets = df_timesheets[
            ~df_timesheets['location'].astype(str).str.lower().isin(ignored_locations_lower)
        ]

    # Detect optional start/end columns on scheduled file
    start_col = find_first_existing_column(df_scheduled, SCHEDULED_START_CANDIDATES)
    end_col = find_first_existing_column(df_scheduled, SCHEDULED_END_CANDIDATES)

    # Set of unique worked shifts for fast membership checks
    worked_shifts = set(
        zip(
            df_timesheets[KEY_COLUMNS[0]],
            df_timesheets[KEY_COLUMNS[1]],
            df_timesheets[KEY_COLUMNS[2]]
        )
    )

    missed_shifts_count = 0
    missed_by_employee = defaultdict(list)

    for _, row in df_scheduled.iterrows():
        scheduled_key = (
            row[KEY_COLUMNS[0]],
            row[KEY_COLUMNS[1]],
            row[KEY_COLUMNS[2]]
        )
        if scheduled_key not in worked_shifts:
            missed_shifts_count += 1
            entry = {
                'date': row['date'],
                'location': row['location'],
            }
            if start_col and end_col:
                entry['start'] = row[start_col]
                entry['end'] = row[end_col]
            missed_by_employee[row['employee']].append(entry)

    return missed_by_employee, missed_shifts_count

def find_missed_shifts():
    """
    Cross-references scheduled shifts with worked timesheets to find missed shifts.
    """
    # Resolve file paths only when calling the CLI-style function
    scheduled_file = SCHEDULED_FILE or find_latest_csv_by_prefix("report - scheduled-hours")
    timesheet_file = TIMESHEET_FILE or find_latest_csv_by_prefix("report - timesheets")

    print(f"Loading scheduled hours from: {scheduled_file}")
    print(f"Loading timesheets from: {timesheet_file}\n")

    try:
        # Load the CSVs with on-read whitespace normalization
        converters = {col: strip_whitespace for col in KEY_COLUMNS}
        df_scheduled = pd.read_csv(scheduled_file, converters=converters)
        df_timesheets = pd.read_csv(timesheet_file, converters=converters)

        missed_by_employee, missed_shifts_count = find_missed_shifts_from_dfs(df_scheduled, df_timesheets)

        if missed_shifts_count == 0:
            print("\nAll scheduled shifts appear to have a corresponding timesheet entry.")
        else:
            print("")
            for employee in sorted(missed_by_employee.keys()):
                print(f"Employee: {employee}")
                for s in missed_by_employee[employee]:
                    if 'start' in s and 'end' in s:
                        print(f"  - {s['date']} — {s['location']} (Scheduled: {s['start']} - {s['end']})")
                    else:
                        print(f"  - {s['date']} — {s['location']}")
                print("-" * 30)
            print(f"Found a total of {missed_shifts_count} missed shifts across {len(missed_by_employee)} employee(s).")

    except FileNotFoundError as e:
        print(f"Error: File not found.")
        print(f"Please make sure '{e.filename}' is in the same directory as the script.")
    except KeyError as e:
        print(f"Error: A required column {e} was not found in one of the files.")
        print("Please ensure both files contain 'employee', 'date', and 'location' columns.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    find_missed_shifts()
