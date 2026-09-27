import { body, equal, fail, hash, hmac, json, limit, now, randomToken } from './http.js';
const TTL = 10 * 60, SESSION_TTL = 7 * 24 * 60 * 60;
function requireSecret(env) { if (!env.OTP_SECRET || env.OTP_SECRET.length < 32) fail(503, 'ログイン設定の準備中です。'); }
function development(request, env) { return env.APP_ENV === 'development' && env.MAIL_DELIVERY_MODE === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname); }
function emailAddress(value) { if (typeof value !== 'string') fail(400, 'メールアドレスを入力してください。'); const email = value.trim().toLowerCase(); if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'メールアドレスの形式を確認してください。'); return email; }
function cookieName(request) { return new URL(request.url).protocol === 'https:' ? '__Host-compass_session' : 'compass_session'; }
function sessionCookie(request, token, age = SESSION_TTL) { return cookieName(request) + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + (new URL(request.url).protocol === 'https:' ? '; Secure' : ''); }
function readToken(request) { return (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName(request) + '='))?.split('=')[1] || ''; }
function code() { let n; do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= 4294000000); return String(n % 1000000).padStart(6, '0'); }
export async function requestCode(request, env) {
  requireSecret(env); const input = await body(request), email = emailAddress(input.email), isDev = development(request, env);
  const mailReady = env.MAIL_FROM && ((env.MAIL_DELIVERY_MODE === 'resend' && env.RESEND_API_KEY) || (env.MAIL_DELIVERY_MODE === 'cloudflare' && env.EMAIL?.send));
  if (!isDev && !mailReady) fail(503, '認証メールの送信設定を準備中です。');
  const emailKey = await hmac(env.OTP_SECRET, 'email:' + email), ipKey = await hmac(env.OTP_SECRET, 'ip:' + (request.headers.get('CF-Connecting-IP') || 'local'));
  await limit(env, 'otp-email:' + emailKey, 5, 900); await limit(env, 'otp-cooldown:' + emailKey, 1, 60); await limit(env, 'otp-ip:' + ipKey, 20, 900); await limit(env, 'otp-global', 200, 3600);
  const id = crypto.randomUUID(), value = code(), time = now(), digest = await hmac(env.OTP_SECRET, id + ':' + email + ':' + value);
  await env.DB.batch([
    env.DB.prepare('UPDATE login_challenges SET consumed_at=? WHERE email=? AND consumed_at IS NULL').bind(time, email),
    env.DB.prepare('INSERT INTO login_challenges(id,email,code_digest,created_at,expires_at) VALUES(?,?,?,?,?)').bind(id, email, digest, time, time + TTL)
  ]);
  if (!isDev) {
    try {
      const message = { from: env.MAIL_FROM, to: [email], subject: 'AI Design Compass の確認コード', text: '確認コード: ' + value + '\n\n10分以内に入力してください。このコードは1回だけ使えます。\nこのメールに心当たりがなければ、操作は不要です。' };
      if (env.MAIL_DELIVERY_MODE === 'cloudflare') {
        await env.EMAIL.send(message);
      } else {
        const result = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'login-' + id }, body: JSON.stringify(message) });
        if (!result.ok) throw new Error('mail_send_failed');
      }
    } catch {
      await env.DB.prepare('UPDATE login_challenges SET consumed_at=? WHERE id=?').bind(now(), id).run();
      fail(503, 'メールを送信できませんでした。少し待ってから再送してください。', 'mail_unavailable');
    }
  }
  return json({ challengeId: id, expiresIn: TTL, resendAfter: 60, ...(isDev ? { developmentCode: value } : {}) });
}
export async function verifyCode(request, env) {
  requireSecret(env); const input = await body(request);
  if (typeof input.challengeId !== 'string' || input.challengeId.length > 80 || !/^\d{6}$/.test(input.code || '')) fail(400, '6桁の確認コードを入力してください。');
  const ipKey = await hmac(env.OTP_SECRET, 'ip:' + (request.headers.get('CF-Connecting-IP') || 'local')); await limit(env, 'verify:' + ipKey, 60, 900);
  const challenge = await env.DB.prepare('UPDATE login_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING *').bind(input.challengeId, now()).first();
  if (!challenge || !equal(challenge.code_digest, await hmac(env.OTP_SECRET, challenge.id + ':' + challenge.email + ':' + input.code))) fail(400, 'コードが違うか、有効期限・試行回数を超えています。', 'invalid_code');
  const claimed = await env.DB.prepare('UPDATE login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? RETURNING id').bind(now(), challenge.id, now()).first();
  if (!claimed) fail(400, 'このコードは使用済みです。', 'invalid_code');
  const uid = crypto.randomUUID(), token = randomToken(), time = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?) ON CONFLICT(email) DO NOTHING').bind(uid, challenge.email, time),
    env.DB.prepare('INSERT INTO sessions(token_digest,user_id,created_at,expires_at) SELECT ?,id,?,? FROM users WHERE email=?').bind(await hash(token), time, time + SESSION_TTL, challenge.email)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token) });
}
export async function user(request, env) {
  const token = readToken(request); if (!/^[a-f0-9]{64}$/.test(token)) fail(401, 'ログインしてください。', 'unauthorized');
  const u = await env.DB.prepare('SELECT u.id,u.email,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_digest=? AND s.expires_at>?').bind(await hash(token), now()).first();
  if (!u) fail(401, 'ログインの有効期限が切れました。', 'unauthorized'); return u;
}
export async function logout(request, env) { const token = readToken(request); if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_digest=?').bind(await hash(token)).run(); return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) }); }
export async function grader(request, env) {
  if (!env.GRADING_API_KEY || env.GRADING_API_KEY.length < 24) fail(503, '採点APIの準備中です。');
  const raw = request.headers.get('authorization') || '';
  if (!raw.startsWith('Bearer ') || !equal(await hash(raw.slice(7)), await hash(env.GRADING_API_KEY))) fail(401, '採点APIキーが必要です。', 'unauthorized');
}
