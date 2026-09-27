import { enqueueQuiz, syncQuizJobs } from './job-adapter.js';
import { choiceFeedback } from './choice-feedback.js';
import { decide, domainStats, publicQuestion, unpack, screeningSize, domains, MIN, MAX } from './adaptive.js';
import { body, fail, hash, json, limit, now } from './http.js';
export async function loadAttempt(env, id, userId) {
  const a = await env.DB.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').bind(id, userId).first();
  if (!a) fail(404, '診断が見つかりません。'); return a;
}
export async function loadAnswers(env, id) { return (await env.DB.prepare('SELECT * FROM answers WHERE attempt_id=? ORDER BY ordinal').bind(id).all()).results; }
// Only full-credit, finalized answers from this user's other attempts count.
export async function masteredQuestions(env, userId, attemptId) {
  const result = await env.DB.prepare("SELECT DISTINCT a.question_id FROM answers a JOIN attempts t ON t.id=a.attempt_id WHERE t.user_id=? AND t.id!=? AND a.score=1 AND a.skipped=0 AND a.status IN ('scored','graded')").bind(userId, attemptId).all();
  return new Set(result.results.map(r => r.question_id));
}
export async function synchronize(env, attempt) {
  if (attempt.status === 'completed' || attempt.current_question_json) return attempt;
  const rows = unpack(await loadAnswers(env, attempt.id)), decision = decide(rows, attempt.seed, await masteredQuestions(env, attempt.user_id, attempt.id), JSON.parse(attempt.settings_json || '{}')), time = now();
  await env.DB.prepare("UPDATE attempts SET status=?,current_question_json=?,completion_reason=?,updated_at=?,completed_at=? WHERE id=? AND revision=? AND current_question_json IS NULL AND status!='completed'")
    .bind(decision.status, decision.question ? JSON.stringify(decision.question) : null, decision.reason, time, decision.status === 'completed' ? time : null, attempt.id, attempt.revision).run();
  return env.DB.prepare('SELECT * FROM attempts WHERE id=?').bind(attempt.id).first();
}
export async function viewAttempt(env, attempt) {
  await syncQuizJobs(env, attempt.id);
  attempt = await synchronize(env, attempt);
  const rows = unpack(await loadAnswers(env, attempt.id));
  const settings = JSON.parse(attempt.settings_json || '{}');
  const screening = screeningSize(await masteredQuestions(env, attempt.user_id, attempt.id), settings);
  const summary = domainStats(rows).filter(d => !settings.domains || settings.domains.includes(d.id)).map(({ posterior, theta, ...d }) => d);
  let answers;
  if (attempt.status === 'completed') {
    const grades = (await env.DB.prepare('SELECT g.* FROM grades g JOIN answers a ON a.id=g.answer_id WHERE a.attempt_id=?').bind(attempt.id).all()).results;
    answers = rows.map(r => {
      const g = grades.find(g => g.answer_id === r.id);
      return { id: r.id, ordinal: r.ordinal, question: r.question, choiceFeedback: choiceFeedback(r.question, r.answer, Boolean(r.skipped)), answer: r.answer, status: r.status, score: r.score, skipped: Boolean(r.skipped), grade: g ? { score: g.score, confidence: g.confidence, feedback: g.feedback, criteria: JSON.parse(g.criteria_json), model: g.model, promptVersion: g.prompt_version } : null };
    });
  }
  return { id: attempt.id, settings, status: attempt.status, revision: attempt.revision, createdAt: attempt.created_at, phase: rows.length < screening ? 'screening' : 'refinement', screening, min: MIN, max: MAX, question: publicQuestion(attempt.current_question_json ? JSON.parse(attempt.current_question_json) : null), reason: attempt.completion_reason, summary, pending: rows.filter(r => r.status === 'pending').length, needsReview: rows.filter(r => r.status === 'needs_review').length, ...(answers ? { answers } : {}) };
}
export async function startAttempt(env, u, request) {
  await limit(env, 'new-attempt:' + u.id, 12, 3600);
  const open = await env.DB.prepare("SELECT * FROM attempts WHERE user_id=? AND status IN ('active','awaiting_grading') ORDER BY created_at DESC LIMIT 1").bind(u.id).first();
  if (open) return json(await viewAttempt(env, open));
  const data = request ? await body(request) : {};
  const level = data.level ?? null, selected = data.domains ?? domains.map(d => d.id);
  if (level !== null && ![1, 2, 3].includes(level)) fail(400, '難易度を選び直してください。');
  if (!Array.isArray(selected) || !selected.length || selected.length > domains.length || selected.some(id => !domains.some(d => d.id === id))) fail(400, 'カテゴリを1つ以上選んでください。');
  const settings = { level, domains: [...new Set(selected)] };
  const id = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0], time = now(), decision = decide([], seed, await masteredQuestions(env, u.id, id), settings);
  await env.DB.prepare("INSERT INTO attempts(id,user_id,seed,status,current_question_json,completion_reason,created_at,updated_at,completed_at,settings_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
    .bind(id, u.id, seed, decision.status, decision.question ? JSON.stringify(decision.question) : null, decision.reason, time, time, decision.status === 'completed' ? time : null, JSON.stringify(settings)).run();
  const actual = await env.DB.prepare("SELECT * FROM attempts WHERE user_id=? AND status IN ('active','awaiting_grading') ORDER BY created_at DESC LIMIT 1").bind(u.id).first();
  return json(await viewAttempt(env, actual || await loadAttempt(env, id, u.id)), 201);
}
export async function answerAttempt(request, env, u, id) {
  await limit(env, 'answer:' + u.id, 60, 60);
  const data = await body(request);
  if (!Number.isInteger(data.revision) || data.revision < 0 || typeof data.questionId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(data.requestKey || '')) fail(400, '問題と送信キーを確認してください。');
  const requestHash = await hash(JSON.stringify({ revision: data.revision, questionId: data.questionId, skipped: data.skipped === true, choice: data.choice ?? null, text: data.text ?? null }));
  const attempt = await loadAttempt(env, id, u.id);
  const existing = await env.DB.prepare('SELECT request_hash FROM answers WHERE attempt_id=? AND request_key=?').bind(id, data.requestKey).first();
  if (existing) { if (existing.request_hash !== requestHash) fail(409, '同じ送信キーで異なる回答は送れません。'); return json(await viewAttempt(env, attempt)); }
  if (attempt.status !== 'active' || attempt.revision !== data.revision || !attempt.current_question_json) fail(409, '問題が更新されています。画面を読み直してください。', 'stale_question');
  const q = JSON.parse(attempt.current_question_json), skipped = data.skipped === true;
  if (q.id !== data.questionId) fail(409, '現在出題されている問題に回答してください。');
  let score = null, answer = {}, status;
  if (skipped) { score = 0; status = 'scored'; }
  else if (q.type === 'choice') {
    if (!Number.isInteger(data.choice) || data.choice < 0 || data.choice >= q.options.length) fail(400, '選択肢を1つ選んでください。');
    answer = { choice: data.choice }; score = data.choice === q.correct ? 1 : 0; status = 'scored';
  } else {
    if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) fail(400, '記述回答を1〜4,000文字で入力してください。');
    answer = { text: data.text.trim() }; status = 'pending';
  }
  const aid = crypto.randomUUID(), time = now();
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO answers(id,attempt_id,ordinal,question_id,question_json,answer_json,kind,status,score,skipped,request_key,request_hash,created_at) SELECT ?,id,?,?,?,?,?,?,?,?,?,?,? FROM attempts WHERE id=? AND user_id=? AND revision=? AND status='active' AND current_question_json IS NOT NULL ON CONFLICT DO NOTHING")
      .bind(aid, data.revision, q.id, attempt.current_question_json, JSON.stringify(answer), q.type, status, score, skipped ? 1 : 0, data.requestKey, requestHash, time, id, u.id, data.revision),
    env.DB.prepare("UPDATE attempts SET revision=revision+1,current_question_json=NULL,updated_at=? WHERE id=? AND revision=? AND status='active' AND EXISTS(SELECT 1 FROM answers WHERE id=?)")
      .bind(time, id, data.revision, aid),
    enqueueQuiz(env, aid, q, answer.text ?? null, time)
  ]);
  if (!result[0].meta.changes) {
    const duplicate = await env.DB.prepare('SELECT request_hash FROM answers WHERE attempt_id=? AND request_key=?').bind(id, data.requestKey).first();
    if (!duplicate || duplicate.request_hash !== requestHash) fail(409, '別の回答が先に保存されました。画面を読み直してください。', 'stale_question');
  }
  return json(await viewAttempt(env, await loadAttempt(env, id, u.id)));
}
export async function finishAttempt(env, u, id) {
  await loadAttempt(env, id, u.id);
  await env.DB.prepare("UPDATE attempts SET status='completed',current_question_json=NULL,completed_at=?,updated_at=?,completion_reason=? WHERE id=? AND user_id=? AND status!='completed'")
    .bind(now(), now(), '途中で終了しました。未確認の分野は判断せず、回答済みの範囲だけを表示しています。', id, u.id).run();
  return json(await viewAttempt(env, await loadAttempt(env, id, u.id)));
}
export async function listAttempts(request, env, u) {
  const cursor = new URL(request.url).searchParams.get('before'); let older = null;
  if (cursor) older = await loadAttempt(env, cursor, u.id);
  const result = await env.DB.prepare('SELECT id,status,revision,created_at,completed_at FROM attempts WHERE user_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21')
    .bind(u.id, older?.id ?? null, older?.created_at ?? 0, older?.created_at ?? 0, older?.id ?? '').all();
  return json({ attempts: result.results.slice(0, 20), nextCursor: result.results.length > 20 ? result.results[19].id : null });
}
