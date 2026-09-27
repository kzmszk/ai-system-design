import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
export function setup() {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const prepare = (sql, args=[]) => ({ bind(...values) { return prepare(sql,values); }, _execute() { const results=sqlite.prepare(sql).all(...args).map(r=>({...r})); return {results,success:true,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}}; }, async first(){return this._execute().results[0]??null},async all(){return this._execute()},async run(){return this._execute()} });
  const DB = {prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>s._execute());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};
  const env={DB,APP_ENV:'development',MAIL_DELIVERY_MODE:'development',OTP_SECRET:'test-otp-secret-32-characters-minimum',GRADING_API_KEY:'test-grading-secret-32-characters-minimum'};
  async function request(path,{method='GET',data,cookie,service=false,origin='http://localhost',headers={}}={}) {
    const h={'Content-Type':'application/json',...headers};if(origin)h.Origin=origin;if(cookie)h.Cookie=cookie;if(service)h.Authorization='Bearer '+env.GRADING_API_KEY;
    const response=await worker.fetch(new Request('http://localhost'+path,{method,headers:h,...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
    let value;try{value=await response.json()}catch{}
    return {status:response.status,value,headers:response.headers};
  }
  async function login(email='learner@example.com') {
    const sent=await request('/api/auth/request-code',{method:'POST',data:{email}});
    if(sent.status!==200)throw new Error(JSON.stringify(sent.value));
    const verified=await request('/api/auth/verify-code',{method:'POST',data:{challengeId:sent.value.challengeId,code:sent.value.developmentCode}});
    if(verified.status!==200)throw new Error(JSON.stringify(verified.value));
    return verified.headers.get('set-cookie').split(';')[0];
  }
  return {env,sqlite,request,login,close:()=>sqlite.close()};
}
export const grade=(points=2,confidence=.9)=>({criteria:[0,1,2].map(index=>({index,points,feedback:'説明できています。'})),confidence,feedback:'観点に沿って説明できています。',model:'mock-model',promptVersion:'test-v1'});
