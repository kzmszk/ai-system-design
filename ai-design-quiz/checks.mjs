import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bank,domains} from './dist/bank.js';
import {createSession,selectQuestion,recordAnswer,shuffledOptions,MIN,MAX,rankedDomains} from './dist/engine.js';
assert.equal(bank.length,72);assert.equal(new Set(bank.map(q=>q.id)).size,72);
for(const d of domains)for(const level of [1,2,3]){const qs=bank.filter(q=>q.domain===d.id&&q.level===level);assert.equal(qs.length,3);assert.equal(qs.filter(q=>q.type==='written').length,1)}
const readme=readFileSync('../README.md','utf8');
const anchors=new Set(readme.split('\n').filter(l=>/^#{1,6} /.test(l)).map(l=>l.replace(/^#+ /,'').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu,'').replace(/ /g,'-')));
for(const q of bank){assert(anchors.has(q.anchor),'Missing README section: '+q.anchor);if(q.type==='choice'){assert.equal(q.options.length,4);assert.equal(new Set(q.options).size,4);assert(q.explanation);const order=shuffledOptions(q,99);assert.deepEqual(order.map(o=>o.index).sort(),[0,1,2,3])}else{assert.equal(q.rubric.length,3);assert(q.model)}}
function run(mode,seed=1){const s=createSession(seed);while(!s.finished){const n=selectQuestion(s);assert(n);const q=n.question;s.current=q;let input;if(mode==='skip')input={skipped:true};else{const score=typeof mode==='function'?mode(q,s):mode==='strong'?1:0;input=q.type==='choice'?{choice:score===1?0:1}:{text:'シミュレーションの回答',criteria:[score>=1/3,score>=2/3,score>=1]}}recordAnswer(s,q,input);assert(s.answers.length<=MAX)}assert(s.answers.length>=MIN);assert.equal(new Set(s.answers.map(a=>a.domain)).size,8);assert.equal(new Set(s.answers.map(a=>a.id)).size,s.answers.length);assert(s.answers.filter(a=>a.type==='written').length>=2);assert(domains.every(d=>s.answers.filter(a=>a.domain===d.id).length<=3));return s}
const strong=run('strong'),weak=run('weak'),skips=run('skip');
assert.equal(strong.answers[2].level,3);assert.equal(weak.answers[2].level,1);
const mixed=run(q=>['caching','rag'].includes(q.domain)?0:1);
assert(['caching','rag'].includes(rankedDomains(mixed)[0].id));
const lengths=new Set();for(let seed=1;seed<=100;seed++){const s=run((q,s)=>((seed*13+s.answers.length*7)%11)>4?1:0,seed);lengths.add(s.answers.length)}
const fresh=createSession(2);fresh.current=selectQuestion(fresh).question;assert.throws(()=>recordAnswer(fresh,fresh.current,{choice:10}));assert.equal(fresh.answers.length,0);
const written=bank.find(q=>q.type==='written');fresh.current=written;assert.throws(()=>recordAnswer(fresh,written,{text:' ',criteria:[true,true,true]}));assert.equal(fresh.answers.length,0);
recordAnswer(fresh,written,{text:'説明が足りなかった',criteria:[false,false,false]});assert.equal(fresh.answers[0].score,0);assert.throws(()=>recordAnswer(fresh,written,{skipped:true}));
console.log(JSON.stringify({bank:bank.length,choice:bank.filter(q=>q.type==='choice').length,written:bank.filter(q=>q.type==='written').length,allCorrect:strong.answers.length,allWrong:weak.answers.length,allSkipped:skips.answers.length,twoWeakDomains:mixed.answers.length,mixedLengths:[...lengths].sort(),simulations:104,sourceAnchors:'all valid'},null,2));
