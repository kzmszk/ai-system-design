CREATE TABLE llm_apps (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  allowed_types TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE llm_jobs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_hash TEXT,
  lease_until INTEGER,
  result_json TEXT,
  result_hash TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(app_id,idempotency_key)
);
CREATE INDEX llm_jobs_ready ON llm_jobs(status,available_at,created_at);
CREATE INDEX llm_jobs_app ON llm_jobs(app_id,created_at);
INSERT INTO llm_jobs(id,app_id,type,version,idempotency_key,input_hash,payload_json,available_at,created_at,updated_at)
 SELECT 'quiz-'||id,'ai-design-compass','quiz.grade',1,id,'internal',json_object('question',json_extract(question_json,'$.prompt'),'modelAnswer',json_extract(question_json,'$.model'),'rubric',json_extract(question_json,'$.rubric'),'answer',json_extract(answer_json,'$.text')),created_at,created_at,created_at
 FROM answers WHERE kind='written' AND status='pending' AND skipped=0;
