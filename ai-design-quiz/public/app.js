const app = document.getElementById('app');
const el = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const labels = { unseen:'未確認', pending:'採点待ち', candidate:'復習候補', review:'復習を優先', evidence:'理解の手がかりあり', uncertain:'追加確認' };
const levels = { 1:'基礎', 2:'応用', 3:'設計' };
const source = anchor => '/guide.html#' + (anchor || '');
let me = null, attempt = null, history = [], nextCursor = null, busy = false, error = '', email = '', challenge = null, resendAt = 0, view = 'loading', draft = '', choice = null, requestKey = crypto.randomUUID(), poll = null, epoch = 0;
const categories = [ ['inference','推論・ハードウェア'], ['scaling','スケーリング・配信'], ['caching','キャッシュ'], ['rag','検索・RAG'], ['agents','エージェント'], ['systems','システム連携・音声'], ['security','セキュリティ'], ['ops','評価・運用・費用'] ];
let quizLevel = '', quizDomains = new Set(categories.map(([id])=>id));
function quizSettingsForm() {
 return '<fieldset class="quiz-settings"><legend>今回の出題条件</legend><label for="quiz-level">難易度</label><select id="quiz-level">'+[['','自動調整（基礎〜設計）'],['1','Lv.1 基礎'],['2','Lv.2 応用'],['3','Lv.3 設計・上級']].map(([value,label])=>'<option value="'+value+'" '+(quizLevel===value?'selected':'')+'>'+label+'</option>').join('')+'</select><p class="small muted">レベルを指定すると、そのレベルの問題だけを出題します。難しい問題に挑戦するならLv.3を選んでください。</p><fieldset class="category-picker"><legend>カテゴリ（複数選択）</legend><div class="category-grid">'+categories.map(([id,label])=>'<label><input type="checkbox" name="quiz-domain" value="'+id+'" '+(quizDomains.has(id)?'checked':'')+'><span>'+label+'</span></label>').join('')+'</div><div class="actions"><button type="button" id="select-all" class="text-button">すべて選択</button><button type="button" id="clear-all" class="text-button">選択を解除</button></div></fieldset><p id="selection-note" class="small" role="status">'+(quizDomains.size?quizDomains.size+'カテゴリを選択中':'カテゴリを1つ以上選んでください。')+'</p></fieldset>';
}
function bindQuizSettings() {
 const update=()=>{el('start').disabled=!quizDomains.size;el('selection-note').textContent=quizDomains.size?quizDomains.size+'カテゴリを選択中':'カテゴリを1つ以上選んでください。'};
 el('quiz-level').onchange=e=>{quizLevel=e.target.value};
 app.querySelectorAll('[name="quiz-domain"]').forEach(input=>input.onchange=()=>{if(input.checked)quizDomains.add(input.value);else quizDomains.delete(input.value);update()});
 const select=all=>{quizDomains=new Set(all?categories.map(([id])=>id):[]);app.querySelectorAll('[name="quiz-domain"]').forEach(input=>input.checked=all);update()};
 el('select-all').onclick=()=>select(true);el('clear-all').onclick=()=>select(false);update();
}
function settingsDescription() {
 const settings=attempt.settings || {};
 return (settings.level?'Lv.'+settings.level+' '+levels[settings.level]:'難易度は自動調整')+' / '+attempt.summary.map(d=>d.name).join('・');
}
async function api(path, data) {
  let response;
  try { response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, ...(data === undefined ? {} : { body:JSON.stringify(data) }) }); } catch { throw Object.assign(new Error('通信できませんでした。入力を残したまま、もう一度お試しください。'), { status:0 }); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || '処理できませんでした。'), { status:response.status, code:payload?.error?.code });
  return payload;
}
function message() { return '<p id="page-error" class="error" role="alert">' + esc(error) + '</p>'; }
function footer() { return '<footer class="footer">教材：<a href="'+source('')+'" target="_blank" rel="noopener noreferrer">AI System Design</a> · Amit Shekhar / Outcome School · <a href="LICENSE.txt">Apache 2.0</a><br>学習のための暫定診断です。少数の問いやLLMの採点だけで、分野全体の習得を保証するものではありません。</footer>'; }
function header() {
  el('account').innerHTML = me ? '<span class="account-email">'+esc(me.email)+'</span><button id="history-button" class="text-button">診断履歴</button><button id="logout" class="text-button">ログアウト</button>' : '';
  if (el('history-button')) el('history-button').onclick = () => action(async () => { await loadHistory(); attempt = null; view = 'dashboard'; epoch++; location.hash = ''; render(); });
  if (el('logout')) el('logout').onclick = () => action(async () => { await api('/auth/logout', {}); epoch++; me = null; attempt = null; history = []; challenge = null; view = 'login'; location.hash = ''; render(); });
}
async function action(fn) {
  if (busy) return; epoch++; clearTimeout(poll); busy = true; error = ''; document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await fn(); } catch (e) {
    error = e.message;
    if (e.status === 401 && me) { me = null; attempt = null; challenge = null; view = 'login'; epoch++; }
    if (e.code === 'stale_question' && attempt) { try { setAttempt(await api('/attempts/'+attempt.id)); error = '別の画面で回答が保存されていたため、最新の問題を表示しました。'; } catch {} }
  } finally { busy = false; render(); }
}
function focusMain() { requestAnimationFrame(() => { app.querySelector('h2')?.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'}); }); }
function renderLogin() {
  app.innerHTML = '<div class="auth-shell"><section class="auth-story"><p class="eyebrow">AI DESIGN COMPASS</p><h1>知っている、から<br>説明できる、へ。</h1><p>まず選択問題で現在地を確認。<br>次に、自分の言葉で理解を確かめます。</p><ol class="auth-steps"><li><span>01</span><div><strong>8分野を選択問題で確認</strong><p>正答状況に合わせて難度を調整。</p></div></li><li><span>02</span><div><strong>弱点候補を絞り込む</strong><p>ここから記述式も。通常12〜16問。</p></div></li><li><span>03</span><div><strong>採点と復習を、あとからも</strong><p>回答とLLMの講評をアカウントに保存。</p></div></li></ol><p class="auth-small">全72問 · 基礎 / 応用 / 設計</p></section><section class="auth-card"><p class="eyebrow">'+(challenge?'CHECK YOUR EMAIL':'WELCOME')+'</p><h2 tabindex="-1">'+(challenge?'確認コードを入力':'メールアドレスで始める')+'</h2><p class="muted">'+(challenge?'<strong>'+esc(email)+'</strong> に送信した6桁のコードを入力してください。有効期限は10分です。':'初めての方も、メールで届く確認コードだけでログインできます。')+'</p>'+message()+(challenge?'<form id="code-form"><label for="code">確認コード</label><input id="code" name="code" class="auth-input code-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"><button class="primary wide" type="submit">確認してログイン</button></form>'+(challenge.developmentCode?'<p class="dev-note">ローカル開発用：メールは送信していません。<br>確認コード：<strong>'+esc(challenge.developmentCode)+'</strong></p>':'')+'<div class="actions"><button id="change-email" class="text-button">メールアドレスを変更</button><button id="resend" class="text-button">コードを再送</button></div>':'<form id="email-form"><label for="email">メールアドレス</label><input id="email" name="email" class="auth-input" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com" value="'+esc(email)+'"><button class="primary wide" type="submit">確認コードを送信</button></form>')+'<p class="auth-privacy">回答・点数・講評をアカウントに保存します。記述の採点では、問題文と回答文をOpenAIへ送信します。メールアドレスは採点データに含めません。</p></section></div><div class="auth-footer">'+footer()+'</div>';
  if (el('email-form')) el('email-form').onsubmit = e => { e.preventDefault(); email = el('email').value.trim(); action(sendCode); };
  if (el('code-form')) el('code-form').onsubmit = e => { e.preventDefault(); const code = el('code').value; action(async () => { await api('/auth/verify-code', {challengeId:challenge.challengeId,code}); me = (await api('/me')).user; challenge = null; await afterLogin(); }); };
  if (el('change-email')) el('change-email').onclick = () => { challenge = null; error = ''; render(); };
  if (el('resend')) el('resend').onclick = () => action(sendCode);
  updateResend();
}
async function sendCode() { challenge = await api('/auth/request-code', {email}); resendAt = Date.now() + challenge.resendAfter * 1000; }
function updateResend() { if (!el('resend')) return; const remaining = Math.max(0, Math.ceil((resendAt-Date.now())/1000)); el('resend').disabled = busy || remaining > 0; el('resend').textContent = remaining ? '再送まで '+remaining+'秒' : 'コードを再送'; }
setInterval(updateResend,1000);
async function loadHistory(cursor) { const result = await api('/attempts'+(cursor?'?before='+encodeURIComponent(cursor):'')); history = cursor ? [...history,...result.attempts] : result.attempts; nextCursor = result.nextCursor; }
async function afterLogin() {
  await loadHistory(); const id = location.hash.slice(1);
  if (/^[a-zA-Z0-9-]+$/.test(id)) { try { setAttempt(await api('/attempts/'+id)); return; } catch (e) { if (e.status !== 404) throw e; location.hash=''; } }
  view = 'dashboard';
}
function renderDashboard() {
  const active = history.find(a=>a.status!=='completed');
  app.innerHTML = '<div class="dashboard"><p class="eyebrow">YOUR LEARNING SPACE</p><h2 tabindex="-1">'+(active?'前回の続きから。':'理解の現在地を、確かめよう。')+'</h2><p class="muted">過去に正解した問題は除外します。選択問題で確認した後、記述式を含めて絞り込みます。</p>'+message()+'<section class="question-card dashboard-start"><div><span class="tag">全72問から正解済みを除いて出題</span><h3>'+ (active?'回答は保存されています':'選択最大8問 → 絞り込み問題')+'</h3><p class="muted">選択問題の正解・記述式の満点（6/6点）は次回から除外。<br>残りの問題数によって、通常より少ない問数で終了します。</p></div>'+(active?'':quizSettingsForm())+'<button id="start" class="primary">'+(active?'診断を続ける':'新しい診断を始める')+'</button></section><section class="history-panel"><h3>これまでの診断</h3>'+(history.length?'<div class="attempt-list">'+history.map(a=>'<button class="attempt-item" data-attempt="'+a.id+'"><span><strong>'+new Date(a.created_at*1000).toLocaleString('ja-JP')+'</strong><span class="muted">'+a.revision+'問回答済み</span></span><span class="status">'+({active:'回答中',awaiting_grading:'採点待ち',completed:'結果を見る'}[a.status])+' →</span></button>').join('')+'</div>':'<p class="empty muted">まだ診断はありません。最初の8問から始めましょう。</p>')+(nextCursor?'<button id="more-history" class="secondary">以前の診断を表示</button>':'')+'</section>'+footer()+'</div>';
  if(!active)bindQuizSettings();
  el('start').onclick = () => action(async()=>{ if(!active && !quizDomains.size)throw new Error('カテゴリを1つ以上選んでください。'); setAttempt(await api('/attempts',active?{}:{level:quizLevel?Number(quizLevel):null,domains:[...quizDomains]})); focusMain(); });
  app.querySelectorAll('[data-attempt]').forEach(b=>b.onclick=()=>action(async()=>{setAttempt(await api('/attempts/'+b.dataset.attempt));focusMain()}));
  if(el('more-history'))el('more-history').onclick=()=>action(()=>loadHistory(nextCursor));
}
function setAttempt(data) {
  if (!attempt || attempt.id!==data.id || attempt.revision!==data.revision) { draft='';choice=null;requestKey=crypto.randomUUID(); }
  attempt=data;view='attempt';location.hash=data.id;
}
function sidebar() { return '<aside class="sidebar"><p class="eyebrow">YOUR LEARNING MAP</p><h1>理解の現在地を<br>見つけよう。</h1><p class="sidebar-copy">'+(attempt.phase==='screening'?'まずは、選択問題だけで確認。':'ここからは、弱点候補を絞り込み。')+'</p><ol class="domain-list">'+attempt.summary.map((d,i)=>'<li class="'+(attempt.question?.domain===d.id?'active':'')+'"><span class="domain-number">'+(d.count?'✓':i+1)+'</span><span>'+d.name+'</span><span class="domain-state">'+(d.pending?'採点待ち':d.count?d.count+'問':'未確認')+'</span></li>').join('')+'</ol><div class="sidebar-foot">Lv.1 基礎 → Lv.2 応用 → Lv.3 設計<br>回答はアカウントに保存済みです。<br>採点待ちの回答は、誤答に数えません。</div></aside>'; }
function frame(content) { content='<p class="session-settings">'+esc(settingsDescription())+'</p>'+content;app.innerHTML='<div class="shell">'+sidebar()+'<section class="main-column">'+content+footer()+'</section></div>'; }
function checkpoint() {
  if(!attempt.screening || attempt.revision!==attempt.screening)return '';
  const targets=attempt.summary.filter(d=>['candidate','review'].includes(d.status));
  return '<section class="phase-checkpoint"><p class="eyebrow">PHASE 01 COMPLETE</p><h3>選択'+attempt.screening+'問で、今回の確認を終えました。</h3><p>'+(targets.length?'追加で確かめたい分野：'+targets.slice(0,3).map(d=>esc(d.name)).join('、'):'各分野で理解の手がかりが得られました。次は、自分の言葉でも説明できるか確かめます。')+'</p><p class="small muted">今回出題した分野の仮判定です。ここから記述を含む絞り込み問題へ進みます。</p></section>';
}
function renderQuestion(){
 const q=attempt.question,d=attempt.summary.find(d=>d.id===q.domain),n=attempt.revision;
 frame('<div class="session-head"><span><strong>'+String(n+1).padStart(2,'0')+'</strong> / 最大16問</span><span class="phase-badge">'+(attempt.phase==='screening'?'01 レベル確認 · 選択式のみ':'02 絞り込み · 選択＋記述')+'</span></div><div class="progress" role="progressbar" aria-label="回答済みの問題数" aria-valuemin="0" aria-valuemax="16" aria-valuenow="'+n+'"><span style="width:'+n/16*100+'%"></span></div>'+checkpoint()+'<p class="live-note">'+esc(attempt.reason)+'</p><article class="question-card"><div class="tags"><span class="tag">'+d.name+'</span><span class="tag level">Lv.'+q.level+' '+levels[q.level]+'</span><span class="tag kind">'+(q.type==='written'?'記述問題 · LLM採点':'選択問題 · 自動採点')+'</span></div><h2 class="question-title" tabindex="-1">'+esc(q.prompt)+'</h2><p class="question-note">'+(q.type==='choice'?'最も適切なものを1つ選んでください。正解と解説は診断終了後に確認できます。':'理由も含め、自分の言葉で説明してください。箇条書きでも構いません。送信後、LLMが採点します。')+'</p>'+(q.type==='choice'?'<fieldset class="options"><legend class="sr-only">回答を1つ選んでください</legend>'+q.options.map((label,i)=>'<label class="option"><input type="radio" name="answer" value="'+i+'" '+(choice===i?'checked':'')+'><span class="option-letter">'+'ABCD'[i]+'</span><span>'+esc(label)+'</span></label>').join('')+'</fieldset>':'<label class="sr-only" for="written">自分の言葉で回答</label><textarea id="written" class="writing" maxlength="4000" placeholder="どのような仕組みか、なぜそう考えるかを説明してください。">'+esc(draft)+'</textarea><div class="counter"><span id="char-count">'+draft.length+'</span> / 4,000文字</div>')+message()+'<div class="actions"><button id="skip" class="text-button">わからない</button><button id="submit" class="primary" '+((q.type==='choice'?choice===null:!draft.trim())?'disabled':'')+'>'+(q.type==='written'?'回答を保存して次へ':'回答を確定して次へ')+'</button></div></article><div class="below-card"><span class="spark">✧</span><span>'+ (attempt.pending?attempt.pending+'件の記述回答を採点待ちです。採点中も選択問題を進められます。':'選択の正誤はサーバーで判定。記述の点数と理由は、採点後に診断へ反映します。')+'</span></div>'+(n?'<button id="finish" class="text-button">ここまでの'+n+'問で診断を終了する</button>':''));
 app.querySelectorAll('input[name="answer"]').forEach(r=>r.onchange=()=>{choice=Number(r.value);el('submit').disabled=false});
 if(el('written'))el('written').oninput=e=>{draft=e.target.value;el('char-count').textContent=draft.length;el('submit').disabled=!draft.trim()};
 const submit=skipped=>action(async()=>{setAttempt(await api('/attempts/'+attempt.id+'/answers',{questionId:q.id,revision:n,requestKey,skipped,...(q.type==='choice'?{choice}:{text:draft})}));focusMain()});
 el('submit').onclick=()=>submit(false);el('skip').onclick=()=>submit(true);if(el('finish'))el('finish').onclick=()=>finish();
}
function finish(){return action(async()=>{setAttempt(await api('/attempts/'+attempt.id+'/finish',{}));focusMain()})}
function renderWaiting(){frame('<article class="question-card waiting-card"><p class="eyebrow">REVIEWING YOUR ANSWERS</p><h2 tabindex="-1">記述の採点を待っています。</h2><div class="waiting-count">'+attempt.pending+'<span>件の回答を採点待ち</span></div><p>'+esc(attempt.reason)+'</p><p class="muted">回答はすべて保存されています。ページを閉じても、診断履歴から続けられます。採点が終わると、結果または必要な追加問題を表示します。</p><p class="small muted">採点依頼は毎日8:00〜23:59（日本時間）、5分ごとに確認します。夜間の回答は翌朝以降に採点します。混雑やPCの停止により遅れる場合があります。</p>'+message()+'<div class="actions"><button id="refresh" class="secondary">採点状況を更新</button><button id="finish" class="text-button">ここまでで終了して結果を見る</button></div></article>');el('refresh').onclick=()=>action(async()=>setAttempt(await api('/attempts/'+attempt.id)));el('finish').onclick=()=>finish()}
function domainCard(d){
 const notes={unseen:'まだ回答していないため、判定していません。',pending:'採点前の回答しかないため、理解度は判定していません。',candidate:'低得点の回答がありました。1問だけでは分野全体を断定できません。',review:'複数の回答で不足が見られました。復習を優先する候補です。',evidence:'今回の範囲で良好な手がかりが得られました。未出題のテーマは未確認です。',uncertain:'確認数が少ないか、結果が混在しています。追加確認が必要です。'};
 const rows=attempt.answers.filter(a=>a.question.domain===d.id);
 return '<article class="result-row"><div class="result-row-head"><h3>'+d.name+'</h3><span class="status '+(['candidate','review'].includes(d.status)?'weak':d.status==='evidence'?'strong':'')+'">'+labels[d.status]+'</span></div><p class="result-meta">'+d.count+'問回答 · '+d.scoredCount+'問採点済み'+(d.pending?' · '+d.pending+'問採点待ち':'')+(d.needsReview?' · '+d.needsReview+'問は採点要確認':'')+'</p><p>'+notes[d.status]+'</p><p class="result-meta">'+esc(d.topics)+'</p><p>'+rows.map(a=>'Lv.'+a.question.level+' '+esc(a.question.topic)+'：'+outcome(a)).join('<br>')+'</p><a class="source-link" target="_blank" rel="noopener noreferrer" href="'+source(d.anchor)+'">この分野を日本語ガイドで復習 ↗</a></article>';
}
function outcome(a){if(a.skipped)return 'わからない';if(a.status==='pending')return '採点待ち';if(a.status==='needs_review')return '採点要確認';if(a.question.type==='choice')return a.score===1?'正解':'見直し';return Math.round(a.score*6)+'/6点（LLM採点）'}
function answerHistory() {
 return '<section class="history"><h3>問題・正解・解説</h3><p class="muted">各問題に自分の回答と解説を表示しています。見直しが終わった問題は折りたためます。</p>'+attempt.answers.map(a=>{
  const q=a.question;
  const yourAnswer=a.skipped?'わからない':q.type==='choice'?q.options[a.answer.choice]:a.answer.text;
  let review;
  if(q.type==='choice') {
   review='<div class="answer-solution"><h4>正解</h4><p>'+esc(q.options[q.correct])+'</p><h4>解説</h4><p>'+esc(q.explanation)+'</p></div>';
   if(!a.skipped && a.score!==1) review+='<div class="answer-feedback"><h4>あなたの回答が正解にならない理由</h4><p>'+esc(a.choiceFeedback || q.explanation)+'</p></div>';
  } else {
   review='<div class="answer-solution"><h4>解答例</h4><p>'+esc(q.model)+'</p><h4>満点のポイント</h4><ul>'+q.rubric.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul></div>';
   if(a.grade) review+='<div class="answer-feedback"><h4>'+(a.grade.score===1?'満点と判断した理由':'満点に届かなかった点・改善方法')+'</h4><p>'+esc(a.grade.feedback)+'</p><ul class="grade-criteria">'+a.grade.criteria.map((c,i)=>'<li><strong>'+c.points+'/2点 · '+esc(q.rubric[i])+'</strong><p>'+esc(c.feedback)+'</p></li>').join('')+'</ul></div><p class="result-meta">採点モデル：'+esc(a.grade.model)+' · 基準：'+esc(a.grade.promptVersion)+'</p>';
   else review+='<p class="muted">'+(a.status==='pending'?'採点後に、観点別の点数と満点に必要な改善点を表示します。':a.status==='needs_review'?'採点を要確認としています。この回答はレベル推定に使いません。':'未回答のため0点です。解答例と満点のポイントを参考にしてください。')+'</p>';
   if(a.status==='needs_review') review+='<p class="dev-note">この採点は要確認のため、レベル推定には使っていません。</p>';
  }
  return '<details open><summary><span class="muted">'+String(a.ordinal+1).padStart(2,'0')+' · Lv.'+q.level+'</span> '+esc(q.topic)+' <span class="status">'+outcome(a)+'</span></summary><h4>問題</h4><p>'+esc(q.prompt)+'</p><div class="answer-yours"><h4>あなたの回答</h4><p>'+esc(yourAnswer)+'</p></div>'+review+'<a class="source-link" target="_blank" rel="noopener noreferrer" href="'+source(q.anchor)+'">日本語ガイドの該当箇所 ↗</a></details>';
 }).join('')+'</section>';
}
function renderResults(){
 const priority=d=>({review:4,candidate:3,unseen:2,pending:2,uncertain:1,evidence:0}[d.status]);
 const sorted=[...attempt.summary].sort((a,b)=>priority(b)-priority(a)),weak=sorted.filter(d=>['review','candidate'].includes(d.status));
 frame('<article class="question-card"><p class="eyebrow">YOUR LEARNING COMPASS</p><div class="result-lead"><div><h2 tabindex="-1">'+(weak.length?'次の学びは、'+weak.slice(0,2).map(d=>esc(d.short)).join('と')+'から。':'理解の手がかりを、次の設計へ。')+'</h2><p class="muted">確認できた範囲と、追加で学ぶ場所を整理しました。</p></div><div class="result-count"><strong>'+attempt.revision+'</strong><span>問の回答を保存</span></div></div><p class="live-note">'+esc(attempt.reason)+'</p>'+(attempt.pending?'<p class="dev-note">記述'+attempt.pending+'件は採点待ちです。採点前の回答を誤答にせず、結果を自動で更新します。</p>':'')+(attempt.needsReview?'<p class="dev-note">'+attempt.needsReview+'件は自動採点で判断できなかったため、レベル推定に使っていません。</p>':'')+message()+'<div class="result-grid">'+sorted.map(domainCard).join('')+'</div>'+answerHistory()+'<div class="actions"><button id="refresh" class="secondary">採点状況を更新</button><button id="restart" class="primary">条件を選んで次の診断へ</button></div></article>');
 el('restart').onclick=()=>action(async()=>{await loadHistory();view='dashboard';location.hash='';focusMain()});el('refresh').onclick=()=>action(async()=>setAttempt(await api('/attempts/'+attempt.id)));
}
function render(){
 clearTimeout(poll);header();
 if(view==='loading')app.innerHTML='<div class="dashboard"><p role="status">アカウントを確認しています…</p></div>';
 else if(!me||view==='login')renderLogin();
 else if(view==='dashboard')renderDashboard();
 else if(attempt.status==='awaiting_grading')renderWaiting();
 else if(attempt.status==='completed')renderResults();
 else renderQuestion();
 schedulePoll();
}
function schedulePoll(){
 clearTimeout(poll);
 if(busy||!me||!attempt||view!=='attempt'||!(attempt.status==='awaiting_grading'||(attempt.status==='completed'&&attempt.pending)))return;
 const id=attempt.id,stamp=epoch;
 poll=setTimeout(async()=>{
   if(busy||stamp!==epoch)return;
   try{
     const data=await api('/attempts/'+id);
     if(busy||stamp!==epoch||view!=='attempt'||attempt?.id!==id)return;
     if(JSON.stringify(data)===JSON.stringify(attempt)&&!error){schedulePoll();return}
     const openDetails=[...app.querySelectorAll('details')].map((d,i)=>d.open?i:-1);
     setAttempt(data);error='';render();
     app.querySelectorAll('details').forEach((d,i)=>{d.open=openDetails.includes(i)});
   }catch(e){if(stamp!==epoch)return;error=e.message;if(e.status===401){me=null;view='login'}render()}
 },5000);
}
el('method-button').onclick=()=>el('method').showModal();el('close-method').onclick=()=>el('method').close();
async function boot(){render();try{me=(await api('/me')).user;await afterLogin()}catch(e){view='login';if(e.status!==401)error=e.message}render()}
boot();
