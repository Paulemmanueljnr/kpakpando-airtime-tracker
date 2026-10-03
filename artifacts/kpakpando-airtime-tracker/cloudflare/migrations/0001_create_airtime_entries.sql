CREATE TABLE IF NOT EXISTS airtime_entries (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Jingle', 'Sponsored Program')),
  client TEXT NOT NULL,
  title TEXT NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Paid', 'Unpaid')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  time_slots TEXT NOT NULL CHECK (json_valid(time_slots)),
  days_of_week TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(days_of_week)),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS airtime_entries_dates_idx
  ON airtime_entries (start_date, end_date);

CREATE INDEX IF NOT EXISTS airtime_entries_payment_status_idx
  ON airtime_entries (payment_status);