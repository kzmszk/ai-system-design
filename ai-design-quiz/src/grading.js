import { body, equal, fail, hash, json, now, randomToken } from './http.js';
const LEASE = 15 * 60, MAX_TRIES = 5;
function packet(row) {
  const q = JSON.parse(row.question_json), answer = JSON.parse(row.answer_json);
  return { id: row.id, attemptId: row.attempt_id, userId: row.user_id, status: row.status, submittedAt: row.created_at, question: { id: q.id, bankVersion: q.bankVersion, prompt: q.prompt, domain: q.domain, level: q.level, modelAnswer: q.model, rubric: q.rubric }, answer: answer.text };
}
export async function pendingAnswers(request, env) {
  const url = new URL(request.url), count = Number(url.searchParams.get('limit') || 10), after = url.searchParams.get('after');
  if (!Number.isInteger(count) || count < 1 || count > 50) fail(400, 'limitは1〜50で指定してください。');
  let cursor = null; if (after) { cursor = await env.DB.prepare('SELECT id,created_at FROM answers WHERE id=?').bind(after).first(); if (!cursor) fail(400, 'カーソルが無効です。'); }
  const rows = (await env.DB.prepare("SELECT a.*,t.user_id FROM answers a JOIN attempts t ON t.id=a.attempt_id WHERE a.kind='written' AND a.status='pending' AND (a.lease_expires_at IS NULL OR a.lease_expires_at<=?) AND a.grading_attempts<? AND (? IS NULL OR a.created_at>? OR (a.created_at=? AND a.id>?)) ORDER BY a.created_at,a.id LIMIT ?")
    .bind(now(), MAX_TRIES, cursor?.id ?? null, cursor?.created_at ?? 0, cursor?.created_at ?? 0, cursor?.id ?? '', count + 1).all()).results;
  return json({ answers: rows.slice(0, count).map(packet), nextCursor: rows.length > count ? rows[count - 1].id : null });
}
export async function claimAnswer(env, id) {
  const token = randomToken(), time = now();
  const row = await env.DB.prepare("UPDATE answers SET lease_digest=?,lease_expires_at=?,grading_attempts=grading_attempts+1 WHERE id=? AND kind='written' AND status='pending' AND (lease_expires_at IS NULL OR lease_expires_at<=?) AND grading_attempts<? RETURNING *")
    .bind(await hash(token), time + LEASE, id, time, MAX_TRIES).first();
  if (!row) fail(409, '採点済みか、別の処理が採点中です。', 'not_claimable');
  const a = await env.DB.prepare('SELECT user_id FROM attempts WHERE id=?').bind(row.attempt_id).first();
  return json({ ...packet({ ...row, user_id: a.user_id }), leaseToken: token, leaseExpiresAt: time + LEASE });
}
export function validateGrade(input, q) {
  if (typeof input.feedback !== 'string' || !input.feedback.trim() || input.feedback.length > 2500 || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || typeof input.promptVersion !== 'string' || !input.promptVersion.trim() || input.promptVersion.length > 100) fail(400, '採点理由・モデル・プロンプト版が必要です。');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) fail(400, 'confidenceは0〜1で指定してください。');
  if (!Array.isArray(input.criteria) || input.criteria.length !== q.rubric.length) fail(400, 'すべての採点観点が必要です。');
  const criteria = input.criteria.map((r, i) => {
    if (!r || r.index !== i || !Number.isInteger(r.points) || r.points < 0 || r.points > 2 || typeof r.feedback !== 'string' || !r.feedback.trim() || r.feedback.length > 1000) fail(400, '各観点にindex、0〜2点のpoints、feedbackを指定してください。');
    return { index: i, points: r.points, feedback: r.feedback.trim() };
  });
  return { criteria, score: criteria.reduce((sum, r) => sum + r.points, 0) / (criteria.length * 2), confidence: input.confidence, feedback: input.feedback.trim(), model: input.model.trim(), promptVersion: input.promptVersion.trim() };
}
export async function saveGrade(request, env, id) {
  const input = await body(request), row = await env.DB.prepare('SELECT * FROM answers WHERE id=?').bind(id).first();
  if (!row || row.kind !== 'written' || row.skipped) fail(404, '採点対象が見つかりません。');
  const grade = validateGrade(input, JSON.parse(row.question_json)), fingerprint = await hash(JSON.stringify(grade));
  const existing = await env.DB.prepare('SELECT * FROM grades WHERE answer_id=?').bind(id).first();
  if (existing) { if (existing.request_hash !== fingerprint) fail(409, '既に別の採点結果が保存されています。'); return json({ ok: true, duplicate: true, score: existing.score }); }
  if (typeof input.leaseToken !== 'string' || input.leaseToken.length > 100 || !equal(row.lease_digest, await hash(input.leaseToken)) || row.lease_expires_at <= now() || row.status !== 'pending') fail(409, '採点のリースが無効です。取得し直してください。', 'invalid_lease');
  const time = now(), status = grade.confidence < .65 ? 'needs_review' : 'graded';
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO grades(answer_id,score,confidence,feedback,criteria_json,model,prompt_version,request_hash,created_at) SELECT id,?,?,?,?,?,?,?,? FROM answers WHERE id=? AND status='pending' AND lease_digest=? AND lease_expires_at>? ON CONFLICT DO NOTHING")
      .bind(grade.score, grade.confidence, grade.feedback, JSON.stringify(grade.criteria), grade.model, grade.promptVersion, fingerprint, time, id, row.lease_digest, time),
    env.DB.prepare("UPDATE answers SET status=?,score=?,graded_at=?,lease_digest=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM grades WHERE answer_id=? AND request_hash=?)")
      .bind(status, status === 'graded' ? grade.score : null, time, id, id, fingerprint)
  ]);
  if (!result[0].meta.changes) {
    const saved = await env.DB.prepare('SELECT request_hash FROM grades WHERE answer_id=?').bind(id).first();
    if (!saved || saved.request_hash !== fingerprint) fail(409, '採点結果が先に更新されました。');
  }
  return json({ ok: true, score: grade.score, status });
}
export async function failGrade(request, env, id) {
  const input = await body(request); if (typeof input.leaseToken !== 'string' || input.leaseToken.length > 100) fail(400, 'leaseTokenが必要です。');
  // Store only a constrained error category, never provider bodies or credentials.
  const reason = ['provider_unavailable', 'invalid_grade', 'grader_error'].includes(input.reason) ? input.reason : 'grader_error';
  const row = await env.DB.prepare("UPDATE answers SET lease_digest=NULL,lease_expires_at=NULL,last_error=?,status=CASE WHEN grading_attempts>=? THEN 'needs_review' ELSE 'pending' END WHERE id=? AND status='pending' AND lease_digest=? AND lease_expires_at>? RETURNING status")
    .bind(reason, MAX_TRIES, id, await hash(input.leaseToken), now()).first();
  if (!row) fail(409, '採点のリースが無効です。'); return json({ ok: true, status: row.status });
}
export async function recoverExpired(env) {
  await env.DB.prepare("UPDATE answers SET status='needs_review',lease_digest=NULL,lease_expires_at=NULL,last_error='grader_error' WHERE status='pending' AND grading_attempts>=? AND lease_expires_at<=?").bind(MAX_TRIES, now()).run();
}
