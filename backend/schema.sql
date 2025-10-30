CREATE TABLE IF NOT EXISTS tm_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_norm TEXT NOT NULL,
  target_text TEXT NOT NULL,
  uses INTEGER DEFAULT 1,
  quality REAL DEFAULT 0.9,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_source TEXT NOT NULL,
  term_target TEXT NOT NULL,
  notes TEXT,
  approved INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT,
  context TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT,
  status TEXT DEFAULT 'new',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tm_entries_source_norm_uq
  ON tm_entries(source_norm);


-- NOVO: logs de traduções (para hotkey e UI)
CREATE TABLE IF NOT EXISTS translation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  origin TEXT DEFAULT 'ui',              -- 'ui' | 'hotkey' | 'api'
  approved INTEGER DEFAULT 0,            -- 0=pending, 1=approved, -1=rejected
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON translation_logs(created_at DESC);

-- Lista Negra: termos que NUNCA devem ser traduzidos
CREATE TABLE IF NOT EXISTS blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
