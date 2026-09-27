CREATE TABLE quiz_job_outbox (
 answer_id TEXT PRIMARY KEY REFERENCES answers(id),
 job_id TEXT,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
 next_sync_at INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX quiz_job_outbox_pending ON quiz_job_outbox(status,next_sync_at);
INSERT INTO quiz_job_outbox(answer_id,job_id,payload_json,created_at)
 SELECT a.id,j.id,json_object('question',json_extract(a.question_json,'$.prompt'),'modelAnswer',json_extract(a.question_json,'$.model'),'rubric',json_extract(a.question_json,'$.rubric'),'answer',json_extract(a.answer_json,'$.text')),a.created_at
 FROM answers a LEFT JOIN llm_jobs j ON j.app_id='ai-design-compass' AND j.idempotency_key=a.id
 WHERE a.kind='written' AND a.status='pending' AND a.skipped=0;
