# Categorization evaluation

The manual evaluation command makes one real Anthropic request per eligible row. It does not write to the database. Automated tests use fake clients and never run this command.

Use a labeled CSV with these columns:

```csv
description,amount,expected_category
Hotel stay,-275.00,Travel
Customer payment,1200.00,Sales Revenue
```

Amounts follow the application convention: positive is an inflow and negative is an outflow. Expected labels must be available to the selected company for that direction. Rows with zero amount are counted as uncovered without making an API call.

Run it with a company ID whose categories define the candidate labels:

```powershell
uv run python -m app.scripts.evaluate_categorization path\to\labeled.csv --company-id <company-uuid>
```

The report compares auto-applied precision and coverage at fixed thresholds from 0.70 through 0.95. The precision target is fixed at 0.95 in the harness. Review the labeled sample and target before running; self-reported confidence is only a calibration signal.
