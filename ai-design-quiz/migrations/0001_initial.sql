PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE login_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX login_email ON login_challenges(email, created_at);
CREATE TABLE sessions (
  token_digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(bucket, window)
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  seed INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','awaiting_grading','completed')),
  revision INTEGER NOT NULL DEFAULT 0,
  current_question_json TEXT,
  completion_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX attempts_user ON attempts(user_id, created_at DESC);
CREATE UNIQUE INDEX one_open_attempt_per_user ON attempts(user_id)
  WHERE status IN ('active','awaiting_grading');
CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  ordinal INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  question_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('choice','written')),
  status TEXT NOT NULL CHECK(status IN ('scored','pending','graded','needs_review')),
  score REAL CHECK(score IS NULL OR (score >= 0 AND score <= 1)),
  skipped INTEGER NOT NULL DEFAULT 0 CHECK(skipped IN (0,1)),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  graded_at INTEGER,
  lease_digest TEXT,
  lease_expires_at INTEGER,
  grading_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE(attempt_id, ordinal),
  UNIQUE(attempt_id, question_id),
  UNIQUE(attempt_id, request_key)
);
CREATE INDEX grading_queue ON answers(status, lease_expires_at, created_at);
CREATE TABLE grades (
  answer_id TEXT PRIMARY KEY REFERENCES answers(id),
  score REAL NOT NULL CHECK(score >= 0 AND score <= 1),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  feedback TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
