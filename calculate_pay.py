import pandas as pd
import numpy as np
import os

# --- Configuration ---
# The script will now find the latest file with this prefix
FILE_PREFIX = "Report - timesheets - "

# Corresponds to Step 1: FilteredData (Locations to exclude)
EXCLUDED_LOCATIONS = [
    "Blu on the Hudson",
    "Chart House",
    "Haven",
    "Ruth's Chris"
]

# Corresponds to Step 1: FilteredData (Employees to exclude)
EXCLUDED_EMPLOYEES = [
    "Nick C",
    "Troy",
    "Andy",
    "Arod",
    "Danny M",
    "Jay",
    "Totals", # Also exclude 'Totals' from aggregations
    ""        # Exclude blank employee names
]

# Columns from the CSV we need to read
# A: employee, E: location, O: tips, P: cost
COLUMNS_TO_USE = ['employee', 'location', 'tips', 'cost']

# --- End Configuration ---

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

def clean_currency(value):
    """Removes '$' and ',' from string and converts to float."""
    if isinstance(value, str):
        value = value.replace('$', '').replace(',', '')
    return pd.to_numeric(value, errors='coerce')

def calculate_payout_report_from_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Core logic extracted to operate on an in-memory DataFrame.
    Returns the final report DataFrame (unformatted).
    """
    # --- Step 1: FilteredData ---
    # Clean whitespace from employee and location columns before filtering
    df = df.copy()
    df['employee'] = df['employee'].astype(str).str.strip()
    df['location'] = df['location'].astype(str).str.strip()

    # Apply the location and employee exclusion filters
    df_filtered = df[
        (~df['location'].isin(EXCLUDED_LOCATIONS)) &
        (~df['employee'].isin(EXCLUDED_EMPLOYEES)) &
        (df['employee'].notna())
    ].copy()

    # Clean currency columns after filtering
    df_filtered['tips'] = df_filtered['tips'].apply(clean_currency).fillna(0)
    df_filtered['cost'] = df_filtered['cost'].apply(clean_currency).fillna(0)

    # --- Step 2: DataWithBonusCol ---
    is_flemings = df_filtered['location'] == "Fleming's Condo"
    cost_gt_tips = df_filtered['cost'] > df_filtered['tips']
    df_filtered['bonus'] = np.where(is_flemings & cost_gt_tips, 13.5, 0)

    # --- Step 3: PreCalculated (Source Data) ---
    df_agg_source = df_filtered[df_filtered['cost'] > df_filtered['tips']].copy()
    df_agg_source['amount_owed'] = (
        df_agg_source['cost'] - df_agg_source['tips'] + df_agg_source['bonus']
    )

    # --- Step 3 & 4: PreCalculated & DataWithAvg ---
    summary = df_agg_source.groupby('employee').agg(
        TotalAmountOwed=('amount_owed', 'sum'),
        ShiftsThatWereOwed=('employee', 'count')
    ).reset_index()

    summary['AverageOwedPerShift'] = summary['TotalAmountOwed'] / summary['ShiftsThatWereOwed']
    summary['AverageOwedPerShift'] = summary['AverageOwedPerShift'].fillna(0)
    summary = summary.sort_values(by='employee')
    summary = summary.rename(columns={'employee': 'Employee'})

    # --- Step 5-7: TotalRow, TotalAvg, FinalTotalRow ---
    total_amount = df_agg_source['amount_owed'].sum()
    total_shifts = len(df_agg_source)
    total_avg = (total_amount / total_shifts) if total_shifts > 0 else 0

    total_row = pd.DataFrame([
        {
            'Employee': 'Total',
            'TotalAmountOwed': total_amount,
            'ShiftsThatWereOwed': total_shifts,
            'AverageOwedPerShift': total_avg
        }
    ])

    final_report = pd.concat([summary, total_row], ignore_index=True)
    return final_report

def calculate_payout_report():
    """
    Reads the latest timesheet CSV and replicates the Excel formula logic
    to generate an employee payout report.
    """
    try:
        # --- Find the latest file ---
        INPUT_FILE = find_latest_csv_by_prefix(FILE_PREFIX)
        print(f"Processing latest file: {INPUT_FILE}\n")
        
        # Load only the columns we need
        df = pd.read_csv(INPUT_FILE, usecols=COLUMNS_TO_USE)
        
    except FileNotFoundError as e:
        print(f"Error: {e}")
        print("Please make sure a CSV file starting with 'Report - timesheets - ' is in the same directory.")
        return
    except ValueError as e:
        print(f"Error: Missing required columns in the CSV. Make sure it contains: {', '.join(COLUMNS_TO_USE)}")
        print(f"Details: {e}")
        return
    except Exception as e:
        print(f"An unexpected error occurred during file loading: {e}")
        return

    # Delegate to the DataFrame-based implementation
    final_report = calculate_payout_report_from_df(df)

    # --- Final Output ---
    print("--- Employee Payout Report ---")
    
    # Format the currency columns for printing
    final_report['TotalAmountOwed'] = final_report['TotalAmountOwed'].map('${:,.2f}'.format)
    final_report['AverageOwedPerShift'] = final_report['AverageOwedPerShift'].map('${:,.2f}'.format)

    # Print the final DataFrame to the terminal as a string
    # index=False hides the row numbers (0, 1, 2...)
    print(final_report.to_string(index=False))
    print("\nCalculation complete.")

if __name__ == "__main__":
    calculate_payout_report()