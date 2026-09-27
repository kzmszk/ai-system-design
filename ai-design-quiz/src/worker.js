import { syncQuizJobs } from './job-adapter.js';
import { configFrom, gradeBatch } from './grader-client.js';
import { requestCode, verifyCode, user, logout, grader } from './auth.js';
import { answerAttempt, finishAttempt, listAttempts, loadAttempt, startAttempt, viewAttempt } from './attempts.js';
import { claimAnswer, failGrade, pendingAnswers, recoverExpired, saveGrade } from './grading.js';
import { fail, HttpError, json, now, sameOrigin, secure } from './http.js';
async function route(request, env) {
  const path = new URL(request.url).pathname, method = request.method;
  if (!path.startsWith('/api/')) {
    // Only public/ is uploaded as assets. Answer keys and rubrics stay in src/.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Static assets unavailable', { status: 404 });
  }
  if (!env.DB) fail(503, 'データベースの準備中です。');
  if (path.startsWith('/api/grading/')) {
    await grader(request, env); await recoverExpired(env);
    if (method === 'GET' && path === '/api/grading/answers') return pendingAnswers(request, env);
    const match = path.match(/^\/api\/grading\/answers\/([a-zA-Z0-9-]+)\/(claim|grade|fail)$/);
    if (method === 'POST' && match) {
      if (match[2] === 'claim') return claimAnswer(env, match[1]);
      if (match[2] === 'grade') return saveGrade(request, env, match[1]);
      return failGrade(request, env, match[1]);
    }
    fail(404, 'APIが見つかりません。');
  }
  if (!['GET', 'HEAD'].includes(method)) sameOrigin(request);
  if (method === 'POST' && path === '/api/auth/request-code') return requestCode(request, env);
  if (method === 'POST' && path === '/api/auth/verify-code') return verifyCode(request, env);
  if (method === 'POST' && path === '/api/auth/logout') return logout(request, env);
  const u = await user(request, env);
  if (method === 'GET' && path === '/api/me') return json({ user: u });
  if (path === '/api/attempts') {
    if (method === 'GET') return listAttempts(request, env, u);
    if (method === 'POST') return startAttempt(env, u, request);
  }
  const match = path.match(/^\/api\/attempts\/([a-zA-Z0-9-]+)(?:\/(answers|finish))?$/);
  if (match) {
    if (method === 'GET' && !match[2]) { await recoverExpired(env); return json(await viewAttempt(env, await loadAttempt(env, match[1], u.id))); }
    if (method === 'POST' && match[2] === 'answers') return answerAttempt(request, env, u, match[1]);
    if (method === 'POST' && match[2] === 'finish') return finishAttempt(env, u, match[1]);
  }
  fail(404, 'APIが見つかりません。');
}
const worker = {
  async fetch(request, env) {
    try { return secure(await route(request, env), request); }
    catch (error) {
      const expected = error instanceof HttpError;
      if (!expected) console.error('request_failed', { name: error.name });
      return secure(json({ error: { code: expected ? error.code : 'internal_error', message: expected ? error.message : '処理できませんでした。時間をおいて再度お試しください。' } }, expected ? error.status : 500), request);
    }
  },
  async scheduled(event, env) {
    if(event.cron === "*/5 * * * *") { await syncQuizJobs(env); return; }
    if (event.cron === '*/1 * * * *') {
      if (!env.OPENAI_API_KEY || !env.GRADING_API_KEY) return;
      // Reuse the authenticated API contract without a network self-fetch.
      const config = configFrom({ ...env, QUIZ_API_URL: 'https://quiz.internal' });
      const result = await gradeBatch(config, { apiFetch: (url, options) => worker.fetch(new Request(url, options), env), limit: 3 });
      console.log('grading_batch', result);
      return;
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_challenges WHERE expires_at<?').bind(now() - 86400),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now())
    ]);
    await recoverExpired(env);
  }
};

export default worker;
