import {bank,domains} from './bank.js';
import {createSession,selectQuestion,recordAnswer,stats,rankedDomains,shuffledOptions,MIN,MAX} from './engine.js';
const app=document.querySelector('#app');
const byId=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const levels={1:'基礎',2:'応用',3:'設計'};
const source=anchor=>'https://ai-design-compass.kazumasa.workers.dev/guide.html#'+anchor;
let session=createSession(),selection=null,why='',draft='',revealed=false;
function sidebar(){
 return '<aside class="sidebar"><p class="eyebrow">YOUR LEARNING MAP</p><h1>理解の現在地を<br>見つけよう。</h1><p class="sidebar-copy">正解の数より、次に学ぶこと。<br>8分野を、10〜16問で確認します。</p><ol class="domain-list">'+domains.map((d,i)=>{const count=stats(session,d.id).count,active=!session.finished&&session.current?.domain===d.id;return '<li class="'+(active?'active':'')+'" '+(active?'aria-current="step"':'')+'><span class="domain-number">'+(count?'✓':i+1)+'</span><span>'+d.name+'</span><span class="domain-state">'+(active?'確認中':count?count+'問':'未確認')+'</span></li>'}).join('')+'</ol><div class="sidebar-foot">Lv.1 基礎 → Lv.2 応用 → Lv.3 設計<br>全72問から、必要な問いを選びます。<br>記述は模範解答を使って自己採点。</div></aside>';
}
function frame(content){
 app.innerHTML='<div class="shell">'+sidebar()+'<section class="main-column">'+content+'<footer class="footer">教材：<a href="'+source('')+'" target="_blank" rel="noopener noreferrer">AI System Design</a> · Amit Shekhar / Outcome School · <a href="LICENSE.txt" target="_blank" rel="noopener noreferrer">Apache 2.0</a><br>学習用の暫定診断です。少数の問題だけで分野全体の習得を保証するものではありません。<br>回答は外部送信せず、この画面内だけで保持します。再読み込みすると消えます。</footer></section></div>';
}
function focusHeading(){const el=app.querySelector('h2');if(el){el.tabIndex=-1;el.focus({preventScroll:true})}window.scrollTo({top:0,behavior:'instant'})}
function next(){
 selection=null;draft='';revealed=false;
 if(!session.finished){const next=selectQuestion(session);if(!next){session.finished=true;session.reason='出題可能な問題を確認し終えました。'}else{session.current=next.question;why=next.why}}
 render();focusHeading();
}
function answerForm(q){
 if(q.type==='choice')return '<fieldset class="options"><legend class="sr-only">回答を1つ選んでください</legend>'+shuffledOptions(q,session.seed).map((o,i)=>'<label class="option"><input type="radio" name="answer" value="'+o.index+'"><span class="option-letter">'+'ABCD'[i]+'</span><span>'+escape(o.label)+'</span></label>').join('')+'</fieldset>';
 return '<label class="sr-only" for="written">自分の言葉で回答</label><textarea id="written" class="writing" maxlength="4000" placeholder="自分の言葉で、理由も含めて説明してみてください。箇条書きでも構いません。" '+(revealed?'readonly':'')+'>'+escape(draft)+'</textarea><div class="counter"><span id="char-count">'+draft.length+'</span> / 4,000文字</div>'+(revealed?'<section class="rubric" aria-labelledby="rubric-heading"><p class="eyebrow">SELF REVIEW</p><h3 id="rubric-heading">書いた内容を、3つの観点で照合</h3><p><strong>解答例</strong><br>'+escape(q.model)+'</p><p class="muted">元の回答で説明できていた項目だけにチェックしてください。表現は一致しなくても構いません。自動採点ではありません。</p>'+q.rubric.map((r,i)=>'<label><input type="checkbox" class="criterion" value="'+i+'"><span>'+escape(r)+'</span></label>').join('')+'<hr class="rubric-divider"><label><input type="checkbox" id="review-confirm"><span>3つの観点を照合しました（該当が0個でも進めます）</span></label></section>':'');
}
function renderQuestion(){
 const q=session.current,d=domains.find(d=>d.id===q.domain),count=session.answers.length,covered=domains.filter(d=>stats(session,d.id).count).length;
 frame('<div class="session-head"><span><strong>'+String(count+1).padStart(2,'0')+'</strong> / 最大'+MAX+'問</span><span class="muted">'+covered+' / 8分野を確認 · '+count+'問回答済み</span></div><div class="progress" role="progressbar" aria-label="最大出題数に対する回答済み問題数" aria-valuemin="0" aria-valuemax="16" aria-valuenow="'+count+'"><span style="width:'+count/MAX*100+'%"></span></div><p class="live-note" role="status">'+(count>=8?'✧ ':'')+escape(why)+'</p><article class="question-card"><div class="tags"><span class="tag">'+d.name+'</span><span class="tag level">Lv.'+q.level+' '+levels[q.level]+'</span><span class="tag kind">'+(q.type==='written'?'記述問題 · 自己採点':'選択問題')+'</span></div><h2 class="question-title">'+escape(q.prompt)+'</h2><p class="question-note">'+(q.type==='written'?(revealed?'模範解答を見る前に書いた文章を、以下の観点で確認します。':'まず自分の言葉で説明してください。確定後に模範解答が表示されます。'):'最も適切なものを1つ選んでください。正解と解説は診断後に確認できます。')+'</p>'+answerForm(q)+'<p id="answer-error" class="error" role="alert"></p><div class="actions">'+(!revealed?'<button id="skip" class="text-button">わからない</button>':'<span class="muted small">自己採点は補助的な証拠として扱います。</span>')+'<button id="submit" class="primary" disabled>'+(q.type==='choice'?'回答を確定して次へ':revealed?'採点を確定して次へ':'回答を書いて、観点を確認')+'</button></div></article><div class="below-card"><span class="spark">✧</span><span>難しい問題は「わからない」でも大丈夫。'+(count<8?'まず8分野を見渡し、追加の問いを選びます。':'最低10問以降、復習の方向が見えたら出題を短縮します。')+'</span></div>'+(count?'<button id="finish" class="text-button">ここまでの'+count+'問で結果を見る</button>':''));
 if(q.type==='choice')app.querySelectorAll('input[name="answer"]').forEach(r=>r.onchange=()=>{selection=Number(r.value);byId('submit').disabled=false});
 else if(!revealed){byId('written').oninput=e=>{draft=e.target.value;byId('char-count').textContent=draft.length;byId('submit').disabled=!draft.trim()};byId('submit').disabled=!draft.trim()}
 else byId('review-confirm').onchange=e=>byId('submit').disabled=!e.target.checked;
 byId('submit').onclick=()=>{
  if(q.type==='written'&&!revealed){draft=byId('written').value;if(!draft.trim())return;revealed=true;renderQuestion();byId('rubric-heading').tabIndex=-1;byId('rubric-heading').focus();return}
  try{recordAnswer(session,q,q.type==='choice'?{choice:selection}:{text:draft,criteria:Array.from(app.querySelectorAll('.criterion')).map(c=>c.checked)});next()}catch(e){byId('answer-error').textContent=e.message}
 };
 if(byId('skip'))byId('skip').onclick=()=>{recordAnswer(session,q,{skipped:true,text:draft});next()};
 if(byId('finish'))byId('finish').onclick=()=>{session.finished=true;session.reason='途中で診断を終了しました。未確認の分野は判定せず、回答済みの範囲だけを表示しています。';render();focusHeading()};
}
function status(d){
 if(!d.count)return {text:'未確認',className:'',note:'この分野はまだ出題していません。理解度を判断する情報がありません。'};
 if(d.mean<.6){const repeated=d.rows.filter(a=>a.score<.6).length>=2;return {text:repeated?'復習を優先':'復習候補',className:'weak',note:repeated?'複数の回答で説明や判断に不足が見られました。基礎から見直す候補です。':'1問の結果からの候補です。分野全体が苦手とはまだ断定できません。'}}
 if(d.count>=2&&d.mean>=.75)return {text:'理解の手がかりあり',className:'strong',note:'今回確認した内容では良好な手がかりが得られました。未出題のテーマや難度は未確認です。'};
 return {text:'追加確認',className:'',note:d.count===1?'正答・説明できた内容はありますが、1問だけのため追加確認が必要です。':'回答によって結果が異なります。解説と記述の不足観点を照合してください。'};
}
function outcome(a,q){if(a.skipped)return 'わからない';return q.type==='choice'?(a.score===1?'正解':'見直し'):a.criteria.filter(Boolean).length+'/3観点（自己採点）'}
function domainResult(d){
 const st=status(d),attempted=[...new Set(d.rows.map(a=>a.level))].sort();
 const misses=d.rows.filter(a=>a.score<1),targets=misses.length?misses:d.rows;
 const links=[...new Map(targets.map(a=>{const q=bank.find(q=>q.id===a.id);return [q.anchor,q]})).values()];
 return '<article class="result-row"><div class="result-row-head"><h3>'+d.name+'</h3><span class="status '+st.className+'">'+st.text+'</span></div><p class="result-meta">'+d.count+'問確認'+(attempted.length?' · 出題：'+attempted.map(l=>'Lv.'+l).join(' / '):'')+(d.written?' · 記述自己採点 '+d.written+'問':'')+'</p><p>'+st.note+'</p><p class="result-meta">'+d.topics+'</p>'+(d.count?'<p>'+d.rows.map(a=>{const q=bank.find(q=>q.id===a.id);return escape(q.topic)+'：'+outcome(a,q)}).join(' / ')+'</p>':'')+'<div class="scale" aria-hidden="true">'+[1,2,3].map(l=>'<span class="'+(d.rows.some(a=>a.level===l&&a.score>=2/3)?'on':'')+'"></span>').join('')+'</div><p class="result-meta">色付き：その難度で正答、または記述の2観点以上を説明。習得率ではありません。</p>'+(links.length?links.map(q=>'<a class="source-link" target="_blank" rel="noopener noreferrer" href="'+source(q.anchor)+'">'+escape(q.topic)+'をREADMEで復習 ↗</a>').join('<br>'):'<a class="source-link" target="_blank" rel="noopener noreferrer" href="'+source(d.anchor)+'">この分野をREADMEで読む ↗</a>')+'</article>';
}
function history(){return '<section class="history"><h3>回答と解説を振り返る</h3>'+session.answers.map((a,i)=>{const q=bank.find(q=>q.id===a.id);return '<details><summary><span class="muted">'+String(i+1).padStart(2,'0')+' · Lv.'+q.level+'</span> '+escape(q.topic)+' <span class="status">'+outcome(a,q)+'</span></summary><p><strong>問い</strong><br>'+escape(q.prompt)+'</p>'+(q.type==='choice'?'<p><strong>あなたの回答</strong><br>'+escape(a.skipped?'わからない':q.options[a.choice])+'</p><p><strong>正解</strong><br>'+escape(q.options[q.correct])+'</p><p>'+escape(q.explanation)+'</p>':'<p><strong>あなたの回答</strong><br>'+escape(a.text||'わからない')+'</p><p><strong>解答例</strong><br>'+escape(q.model)+'</p><p><strong>採点観点</strong><br>'+q.rubric.map((r,k)=>(a.skipped?'・':a.criteria[k]?'✓ ':'未確認：')+escape(r)).join('<br>')+'</p>')+'<a class="source-link" target="_blank" rel="noopener noreferrer" href="'+source(q.anchor)+'">日本語ガイドの該当箇所 ↗</a></details>'}).join('')+'</section>'}
function renderResults(){
 const ranked=rankedDomains(session),weak=ranked.filter(d=>d.count&&d.mean<.6),written=session.answers.filter(a=>a.type==='written'&&!a.skipped).length;
 const lead=weak.length?'次の学びは、'+weak.slice(0,2).map(d=>d.short).join('と')+'から。':'説明できたことを、次の設計へ。';
 frame('<article class="question-card"><p class="eyebrow">YOUR LEARNING COMPASS</p><div class="result-lead"><div><h2>'+lead+'</h2><p class="muted">点数よりも、次に復習する場所を。<br>確認できた範囲と、まだ曖昧な範囲を整理しました。</p></div><div class="result-count"><strong>'+session.answers.length+'</strong><span>問で今回の診断</span></div></div><p class="live-note">'+escape(session.reason)+'</p><p class="result-meta">選択 '+session.answers.filter(a=>a.type==='choice').length+'問 · 記述の実回答 '+written+'問 · 「わからない」 '+session.answers.filter(a=>a.skipped).length+'問</p><div class="priority"><h3>'+ (weak.length?'最初の復習ポイント':'次は、未確認の難度を')+'</h3><p>'+ (weak.length?weak.slice(0,2).map(d=>{const missed=d.rows.find(a=>a.score<.6),q=bank.find(q=>q.id===missed.id);return '<strong>'+d.name+'</strong>：'+escape(q.topic)}).join('<br>'):'今回の少数の問いだけで、すべてを習得したとは判断できません。出題されていない応用・設計のテーマも、自分の言葉で説明してみてください。')+'</p></div><div class="result-grid">'+ranked.map(domainResult).join('')+'</div>'+history()+'<div class="actions"><span class="muted small">復習後に、もう一度。</span><button id="restart" class="primary">新しい診断を始める</button></div></article>');
 byId('restart').onclick=()=>{session=createSession();next()};
}
function render(){if(session.finished)renderResults();else renderQuestion()}
byId('method-button').onclick=()=>byId('method').showModal();byId('close-method').onclick=()=>byId('method').close();
byId('method').addEventListener('click',e=>{if(e.target===byId('method')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
next();
// Only expose a read-only snapshot. Answer keys and draft text are not returned.
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 try{Promise.resolve(document.modelContext.registerTool({name:'get_quiz_progress',title:'診断の進み具合を確認',description:'現在の問題と分野ごとの確認数を読み取ります。回答や自己採点、診断の終了は行いません。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('引数は空のオブジェクトにしてください。');return {finished:session.finished,answered:session.answers.length,current:session.finished?null:{domain:session.current.domain,level:session.current.level,type:session.current.type,prompt:session.current.prompt},domains:domains.map(d=>({name:d.name,answered:stats(session,d.id).count}))}}},{signal:lifecycle.signal})).catch(()=>{});window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true})}catch{}
}
