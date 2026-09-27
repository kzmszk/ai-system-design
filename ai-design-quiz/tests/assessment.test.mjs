import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,grade} from './helpers.mjs';
import {decide,unpack,domainStats,MIN,MAX} from '../src/adaptive.js';
import {bank} from '../src/questions.js';
async function submit(s,cookie,a,extra={}){const row=s.sqlite.prepare('SELECT current_question_json FROM attempts WHERE id=?').get(a.id);const q=JSON.parse(row.current_question_json);return s.request('/api/attempts/'+a.id+'/answers',{method:'POST',cookie,data:{revision:a.revision,questionId:q.id,requestKey:crypto.randomUUID(),...(q.type==='choice'?{choice:q.correct}:{text:'モデルの生成結果を再利用し、共通部分を効率化します。'}),...extra}})}
async function gradeAll(s,confidence=.9){const pending=await s.request('/api/grading/answers',{service:true});for(const item of pending.value.answers){const claim=await s.request('/api/grading/answers/'+item.id+'/claim',{method:'POST',service:true,data:{}});assert.equal(claim.status,200);const saved=await s.request('/api/grading/answers/'+item.id+'/grade',{method:'POST',service:true,data:{...grade(2,confidence),leaseToken:claim.value.leaseToken}});assert.equal(saved.status,200)}}
test('選択8問→記述を含む絞り込み→採点待ち→結果まで、DBとAPIで完結する',async t=>{
 const s=setup();t.after(s.close);const cookie=await s.login();let a=(await s.request('/api/attempts',{method:'POST',cookie,data:{}})).value;
 assert(!('correct' in a.question));assert(!('rubric' in a.question));
 for(let i=0;i<8;i++){assert.equal(a.question.type,'choice');const response=await submit(s,cookie,a);assert.equal(response.status,200,JSON.stringify(response.value));a=response.value}
 assert.equal(a.phase,'refinement');assert.equal(a.question.type,'written');assert.equal(new Set(s.sqlite.prepare('SELECT question_json FROM answers').all().map(r=>JSON.parse(r.question_json).domain)).size,8);
 while(a.revision<12){const r=await submit(s,cookie,a);assert.equal(r.status,200,JSON.stringify(r.value));a=r.value}
 assert.equal(a.status,'awaiting_grading');assert.equal(a.pending,2);assert.equal(a.question,null);
 const pendingRows=s.sqlite.prepare("SELECT * FROM answers WHERE kind='written'").all();assert(pendingRows.every(r=>r.score===null));
 await gradeAll(s);a=(await s.request('/api/attempts/'+a.id,{cookie})).value;assert.equal(a.status,'completed');assert.equal(a.pending,0);assert.equal(a.answers.length,12);assert(a.answers.filter(x=>x.question.type==='written').every(a=>a.grade.model==='mock-model'&&a.score===1));
 assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM grades').get().n,2);
 const history=await s.request('/api/attempts',{cookie});assert.equal(history.value.attempts[0].id,a.id);
});
test('回答の所有権、サーバー採点、重複送信、競合を防ぐ',async t=>{
 const s=setup();t.after(s.close);const cookie=await s.login(),other=await s.login('other@example.com');
 const a=(await s.request('/api/attempts',{method:'POST',cookie,data:{}})).value;
 assert.equal((await s.request('/api/attempts/'+a.id,{cookie:other})).status,404);
 assert.equal((await s.request('/api/attempts/'+a.id+'/finish',{method:'POST',cookie:other,data:{}})).status,404);
 const q=JSON.parse(s.sqlite.prepare('SELECT current_question_json FROM attempts WHERE id=?').get(a.id).current_question_json);
 const input={revision:0,questionId:q.id,requestKey:crypto.randomUUID(),choice:(q.correct+1)%4,score:1};
 const results=await Promise.all([s.request('/api/attempts/'+a.id+'/answers',{method:'POST',cookie,data:input}),s.request('/api/attempts/'+a.id+'/answers',{method:'POST',cookie,data:input})]);
 assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(s.sqlite.prepare('SELECT count(*) AS n FROM answers').get().n,1);assert.equal(s.sqlite.prepare('SELECT score FROM answers').get().score,0);
 assert.equal((await s.request('/api/attempts/'+a.id+'/answers',{method:'POST',cookie,data:{...input,choice:q.correct}})).status,409);
 assert.equal((await s.request('/api/attempts/'+a.id+'/answers',{method:'POST',cookie,data:{...input,requestKey:crypto.randomUUID()}})).status,409);
 assert.equal((await s.request('/api/grading/answers',{cookie})).status,401);
 assert.equal((await s.request('/api/attempts',{method:'POST',cookie,data:{}})).value.id,a.id);
});
test('低確信度の採点はDBに残し、レベル判定に混ぜない',async t=>{
 const s=setup();t.after(s.close);const cookie=await s.login();let a=(await s.request('/api/attempts',{method:'POST',cookie,data:{}})).value;
 for(let i=0;i<12;i++)a=(await submit(s,cookie,a)).value;
 await gradeAll(s,.3);a=(await s.request('/api/attempts/'+a.id,{cookie})).value;assert.equal(a.needsReview,2);assert.equal(a.status,'active');
 const rows=s.sqlite.prepare("SELECT score,status FROM answers WHERE kind='written'").all();assert(rows.every(r=>r.score===null&&r.status==='needs_review'));
});
test('多様な回答でも前半に記述を出さず、重複せず16問以内に終える',()=>{
 const lengths=new Set();for(let seed=0;seed<80;seed++){const rows=[];let decision;for(let n=0;n<=MAX;n++){decision=decide(unpack(rows),seed);if(decision.status==='completed')break;assert.equal(decision.status,'active');const q=decision.question;if(n<8)assert.equal(q.type,'choice');const score=seed%3===0?1:seed%3===1?0:(n*7+seed)%3/2;rows.push({question_id:q.id,question_json:JSON.stringify(q),answer_json:'{}',kind:q.type,status:'scored',score})}assert(rows.length>=MIN&&rows.length<=MAX);assert.equal(new Set(rows.map(r=>r.question_id)).size,rows.length);assert.equal(rows.filter(r=>r.kind==='written').length,2);lengths.add(rows.length)}assert(lengths.size>=2);assert.equal(bank.length,72);
});
