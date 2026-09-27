import {bank,domains} from './bank.js';
export const MIN=10,MAX=16;
const grid=Array.from({length:25},(_,i)=>-2.5+i*.25);
const difficulty={1:-.8,2:.4,3:1.6};
const normalize=a=>{const sum=a.reduce((s,x)=>s+x,0);return a.map(x=>x/sum)};
const prior=()=>normalize(grid.map(t=>Math.exp(-.5*((t-.35)/1.25)**2)));
const sigmoid=x=>1/(1+Math.exp(-x));
function probability(q,t){const p=sigmoid(1.5*(t-difficulty[q.level]));return q.type==='choice'?.25+.75*p:p}
function update(p,q,score,weight){return normalize(p.map((v,i)=>{const s=probability(q,grid[i]);return v*Math.pow(Math.pow(s,score)*Math.pow(1-s,1-score),weight)}))}
function entropy(p){return -p.reduce((s,x)=>s+x*Math.log(x||1),0)}
function info(p,q){const yes=p.reduce((s,v,i)=>s+v*probability(q,grid[i]),0);return entropy(p)-yes*entropy(update(p,q,1,1))-(1-yes)*entropy(update(p,q,0,1))}
export function createSession(seed=Math.floor(Math.random()*2147483647)){return {seed,answers:[],posterior:Object.fromEntries(domains.map(d=>[d.id,prior()])),current:null,reason:'',finished:false}}
export function domainAnswers(s,id){return s.answers.filter(a=>a.domain===id)}
function mean(a){return a.length?a.reduce((v,x)=>v+x.score,0)/a.length:0}
export function stats(s,id){
 const rows=domainAnswers(s,id),p=s.posterior[id],m=p.reduce((sum,v,i)=>sum+v*grid[i],0);
 return {rows,count:rows.length,mean:mean(rows),theta:m,uncertainty:Math.sqrt(p.reduce((sum,v,i)=>sum+v*(grid[i]-m)**2,0)),written:rows.filter(a=>a.type==='written'&&!a.skipped).length};
}
export function stopReason(s){
 if(s.answers.length>=MAX)return '上限の16問に達したため、ここまでの回答で診断しました。証拠の少ない分野は追加確認として残しています。';
 if(s.answers.length<MIN||domains.some(d=>!domainAnswers(s,d.id).length)||s.answers.filter(a=>a.type==='written').length<2)return '';
 const points=domains.map(d=>stats(s,d.id));
 const weak=points.filter(d=>d.mean<.6);
 if(!weak.length&&s.answers.slice(-4).every(a=>a.score>=2/3))return '各分野で理解の手がかりが得られ、追加問題でも大きな弱点が見つからなかったため、出題を短縮しました。全範囲の習得を保証する結果ではありません。';
 if(weak.length>=6&&s.answers.slice(-3).every(a=>a.score<.6))return '多くの分野で基礎の見直しが有効と考えられるため、追加出題を短縮しました。まず基礎を復習してから、再診断するのがおすすめです。';
 if(weak.length>0&&weak.length<=2&&weak.every(d=>d.count>=2&&d.rows.slice(-2).every(a=>a.score<.6)))return '復習を優先する分野が追加問題でも確認できたため、出題を短縮しました。確認数が少ない分野は暫定評価です。';
 return '';
}
export function selectQuestion(s){
 if(s.finished)return null;
 const used=new Set(s.answers.map(a=>a.id)),untested=domains.filter(d=>!domainAnswers(s,d.id).length);
 let pool,why;
 if(untested.length){
  const d=untested[0],recent=s.answers.slice(-3),avg=mean(recent);
  const level=recent.length>=2?(avg>=.85?3:avg<=.35?1:2):2;
  const written=[2,6].includes(s.answers.length);
  pool=bank.filter(q=>q.domain===d.id&&q.level===level&&q.type===(written?'written':'choice'));
  why=s.answers.length===0?'まずは応用問題から。正誤に応じて次の難度を調整します。':'まだ確認していない分野です。ここまでの回答に合わせて難度を選びました。';
 }else{
  const candidates=bank.filter(q=>!used.has(q.id)&&domainAnswers(s,q.domain).length<3);
  const scored=candidates.map(q=>{
   const st=stats(s,q.domain),p=s.posterior[q.domain];
   const priority=1+(st.mean<.6?.75:0)+(st.count===1?.25:0);
   const repetition=s.answers.at(-1)?.domain === q.domain ? .72 : 1;
   const duration=q.type==='written'?1.8:1;
   return {q,value:info(p,q)*priority*repetition/duration};
  }).sort((a,b)=>b.value-a.value);
  pool=scored.slice(0,1).map(x=>x.q);
  why='追加確認：回答が揺れている分野や、復習候補を確かめる問題を選びました。';
 }
 if(!pool?.length)return null;
 const n=(s.seed+s.answers.length*17)%pool.length;
 return {question:pool[n],why};
}
export function recordAnswer(s,q,input){
 if(s.finished||s.answers.some(a=>a.id===q.id)||s.current?.id!==q.id)throw new Error('現在の問題だけに回答できます。');
 const skipped=input.skipped===true;
 let score;
 if(skipped)score=0;
 else if(q.type==='choice'){
  if(!Number.isInteger(input.choice)||input.choice<0||input.choice>=q.options.length)throw new Error('選択肢を選んでください。');
  score=input.choice===q.correct?1:0;
 }else{
  if(typeof input.text!=='string'||!input.text.trim())throw new Error('自分の言葉で回答してください。');
  if(!Array.isArray(input.criteria)||input.criteria.length!==3||input.criteria.some(x=>typeof x!=='boolean'))throw new Error('採点観点を確認してください。');
  score=input.criteria.filter(Boolean).length/3;
 }
 const row={id:q.id,domain:q.domain,type:q.type,level:q.level,score,skipped,choice:input.choice??null,text:input.text??'',criteria:input.criteria??[]};
 s.answers.push(row);s.posterior[q.domain]=update(s.posterior[q.domain],q,score,q.type==='written'?.65:1);s.current=null;
 const reason=stopReason(s);if(reason){s.finished=true;s.reason=reason}
 return row;
}
export function rankedDomains(s){return domains.map(d=>({...d,...stats(s,d.id)})).sort((a,b)=>{
 const priority=x=>!x.count?1.8:x.mean<.6?2+(1-x.mean):x.count<2?1:0;
 return priority(b)-priority(a);
})}
export function shuffledOptions(q,seed){
 const arr=q.options.map((label,index)=>({label,index}));let x=(seed+Array.from(q.id).reduce((a,c)=>a+c.charCodeAt(0),0))>>>0;
 for(let i=arr.length-1;i>0;i--){x=(Math.imul(x,1664525)+1013904223)>>>0;const j=x%(i+1);[arr[i],arr[j]]=[arr[j],arr[i]]}
 return arr;
}
