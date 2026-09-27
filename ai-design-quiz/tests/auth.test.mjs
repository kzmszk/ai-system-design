import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './helpers.mjs';

test('メールコードはハッシュ保存・一度だけ使え、Cookieで本人を識別する',async t=>{
 const s=setup();t.after(s.close);
 const sent=await s.request('/api/auth/request-code',{method:'POST',data:{email:' User@Example.com '}});assert.equal(sent.status,200);assert.match(sent.value.developmentCode,/^\d{6}$/);
 const stored=s.sqlite.prepare('SELECT * FROM login_challenges').get();assert.notEqual(stored.code_digest,sent.value.developmentCode);assert.equal(stored.email,'user@example.com');
 const input={challengeId:sent.value.challengeId,code:sent.value.developmentCode};
 const responses=await Promise.all([s.request('/api/auth/verify-code',{method:'POST',data:input}),s.request('/api/auth/verify-code',{method:'POST',data:input})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
 const cookie=responses.find(r=>r.status===200).headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
 assert.equal((await s.request('/api/me',{cookie})).value.user.email,'user@example.com');
 await s.request('/api/auth/logout',{method:'POST',cookie,data:{}});assert.equal((await s.request('/api/me',{cookie})).status,401);
});
test('コードの期限、試行制限、再送間隔を強制する',async t=>{
 const s=setup();t.after(s.close);const sent=await s.request('/api/auth/request-code',{method:'POST',data:{email:'one@example.com'}});
 assert.equal((await s.request('/api/auth/request-code',{method:'POST',data:{email:'one@example.com'}})).status,429);
 const wrong=sent.value.developmentCode==='000000'?'000001':'000000';
 for(let i=0;i<5;i++)assert.equal((await s.request('/api/auth/verify-code',{method:'POST',data:{challengeId:sent.value.challengeId,code:wrong}})).status,400);
 assert.equal((await s.request('/api/auth/verify-code',{method:'POST',data:{challengeId:sent.value.challengeId,code:sent.value.developmentCode}})).status,400);
 const second=await s.request('/api/auth/request-code',{method:'POST',data:{email:'two@example.com'}});s.sqlite.prepare('UPDATE login_challenges SET expires_at=0 WHERE id=?').run(second.value.challengeId);
 assert.equal((await s.request('/api/auth/verify-code',{method:'POST',data:{challengeId:second.value.challengeId,code:second.value.developmentCode}})).status,400);
});
test('クロスサイト送信と本番での開発コード返却を拒否する',async t=>{
 const s=setup();t.after(s.close);
 assert.equal((await s.request('/api/auth/request-code',{method:'POST',origin:'https://evil.example',data:{email:'one@example.com'}})).status,403);
 s.env.APP_ENV='production';assert.equal((await s.request('/api/auth/request-code',{method:'POST',data:{email:'one@example.com'}})).status,503);
 assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM login_challenges').get().n,0);
});
test('再ログインで同じユーザーに戻り、期限切れセッションを使えない',async t=>{
 const s=setup();t.after(s.close);const cookie=await s.login();const first=(await s.request('/api/me',{cookie})).value.user.id;
 s.sqlite.prepare('DELETE FROM rate_limits').run();const again=await s.login();assert.equal((await s.request('/api/me',{cookie:again})).value.user.id,first);
 s.sqlite.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await s.request('/api/me',{cookie:again})).status,401);
});
