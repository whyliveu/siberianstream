const EVENT = 'sibirskiy-strim-2026-11-27';
export const START = Date.parse('2026-11-27T17:00:00+03:00');
export const REMINDER = START - 86400000;
const EXPIRES = START + 10 * 86400000;
const DEFAULT_SITE = 'https://whyliveu.github.io/siberianstream/';
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export const validMeet = value => typeof value === 'string' && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(value);
export async function webhookSecret(token) {
 const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('siberianstream-webhook-v1:'+token));
 return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,'0')).join('');
}
function equal(a,b) { if(typeof a!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
async function readBody(request) {
 if(Number(request.headers.get('content-length'))>16384)throw new Error('too_large');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid');
 let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new Error('too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function telegram(env, method, body) {
 try {
  const r=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  const data=await r.json();
  if(r.ok&&data.ok)return {ok:true,result:data.result};
  return {ok:false,blocked:data.error_code===403,retry:data.error_code===429?Math.max(1,Number(data.parameters?.retry_after)||30):60};
 } catch { return {ok:false,uncertain:method==='sendMessage',retry:60}; }
}
function core(env) {return env.STREAM_BOT.get(env.STREAM_BOT.idFromName(EVENT));}
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith('/api/telegram/'))return env.ASSETS.fetch(request);
  if(url.pathname==='/api/telegram/health'&&request.method==='GET') {
   if(!env.TELEGRAM_BOT_TOKEN||!env.STREAM_BOT)return json({ready:false,reason:'not_configured'});
   return core(env).fetch(new Request('https://internal/health'));
  }
  if(url.pathname!=='/api/telegram/webhook')return json({error:'not_found'},404);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!env.TELEGRAM_BOT_TOKEN||!env.STREAM_BOT)return json({error:'not_configured'},503);
  const expected=await webhookSecret(env.TELEGRAM_BOT_TOKEN);
  if(!equal(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),expected))return json({error:'forbidden'},403);
  let data;try{data=await readBody(request);}catch{return json({error:'invalid_update'},400);}
  const message=data.message;
  if(!Number.isSafeInteger(data.update_id)||data.update_id<0)return json({error:'invalid_update'},400);
  if(message?.chat?.type!=='private'||!Number.isSafeInteger(message.chat.id)||message.chat.id<=0||typeof message.text!=='string')return json({ok:true});
  if(message.text.length>300)return json({ok:true});
  return core(env).fetch(new Request('https://internal/update',{method:'POST',body:JSON.stringify({id:data.update_id,chatId:message.chat.id,text:message.text})}));
 },
 async scheduled(controller,env,ctx) {
  if(!env.TELEGRAM_BOT_TOKEN||!env.STREAM_BOT)return;
  ctx.waitUntil(core(env).fetch(new Request('https://internal/tick',{method:'POST'})));
 }
};

export class StreamBot {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=Promise.resolve();}
 serial(fn){const result=this.pending.then(fn);this.pending=result.catch(()=>{});return result;}
 fetch(request){return this.serial(async()=>{
  const path=new URL(request.url).pathname;
  if(path==='/health'){const setup=await this.ctx.storage.get('setup');const fingerprint=await webhookSecret(this.env.TELEGRAM_BOT_TOKEN);return json({ready:setup?.fingerprint===fingerprint&&setup?.verifiedAt>Date.now()-600000,username:this.env.BOT_USERNAME});}
  if(path==='/update')return this.update(await request.json());
  if(path==='/tick'){try{await this.configure();await this.tick();return json({ok:true});}catch{return json({ok:false,error:'temporarily_unavailable'},503);}}
  return json({error:'not_found'},404);
 });}
 alarm(){return this.serial(()=>this.tick());}
 async configure(){
  if(Date.now()>EXPIRES)return;
  const fingerprint=await webhookSecret(this.env.TELEGRAM_BOT_TOKEN),old=await this.ctx.storage.get('setup');
  if(old?.fingerprint===fingerprint&&old?.verifiedAt>Date.now()-300000)return;
  const webhook=this.env.WEBHOOK_URL;
  if(!/^https:\/\/[^/]+\/api\/telegram\/webhook$/.test(webhook))throw new Error('invalid_webhook_config');
  const me=await telegram(this.env,'getMe',{});
  if(!me.ok||me.result.username?.toLowerCase()!==this.env.BOT_USERNAME.toLowerCase())throw new Error('bot_identity_mismatch');
  const info=await telegram(this.env,'getWebhookInfo',{});
  if(!info.ok)throw new Error('telegram_unavailable');
  if(old?.fingerprint!==fingerprint||old?.url!==webhook||info.result.url!==webhook){
   const set=await telegram(this.env,'setWebhook',{url:webhook,secret_token:fingerprint,allowed_updates:['message'],max_connections:5,drop_pending_updates:false});
   if(!set.ok)throw new Error('webhook_setup_failed');
   const commands=await telegram(this.env,'setMyCommands',{commands:[{command:'start',description:'Напомнить о Сибирском стриме'},{command:'stop',description:'Отписаться от напоминаний'},{command:'help',description:'Как это работает'}]});
   if(!commands.ok)throw new Error('commands_setup_failed');
  }
  await this.ctx.storage.put('setup',{fingerprint,url:webhook,verifiedAt:Date.now()});
 }
 async status(){
  const cached=await this.ctx.storage.get('stream-status');if(cached?.at>Date.now()-10000)return cached.value;
  const r=await fetch(this.env.STATUS_URL,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('status_unavailable');
  const value=await r.json();if(!['waiting','live','ended'].includes(value.state)||(value.state==='live'&&!validMeet(value.joinUrl)))throw new Error('invalid_stream_status');
  await this.ctx.storage.put('stream-status',{at:Date.now(),value});return value;
 }
 async send(chatId,text,joinUrl){
  const site=this.env.SITE_URL||DEFAULT_SITE;
  return telegram(this.env,'sendMessage',{chat_id:chatId,text,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:joinUrl?'Подключиться к стриму':'Открыть приглашение',url:joinUrl||site}]]}});
 }
 async update(input){
  const key='sub:'+input.chatId,old=await this.ctx.storage.get(key);
  if(old&&input.id<=old.lastUpdate)return json({ok:true});
  const stopped=await this.ctx.storage.get('stop:'+input.chatId);
  if(stopped&&input.id<=stopped.lastUpdate)return json({ok:true});
  const command=input.text.trim().split(/\s/)[0].split('@')[0].toLowerCase();
  if(!['/start','/stop','/help'].includes(command))return json({ok:true});
  const now=Date.now();
  if(command!=='/stop'&&old?.lastAction>now-3000)return json({ok:true});
  if(command==='/stop'){
   await this.ctx.storage.delete(key);
   // Retain only a short-lived tombstone so a delayed /start cannot undo an unsubscribe.
   await this.ctx.storage.put('stop:'+input.chatId,{lastUpdate:input.id,at:now});
   await this.send(input.chatId,'Отписала от напоминаний 💋 Захочешь вернуться — /start');return json({ok:true});
  }
  if(command==='/help'){await this.send(input.chatId,'27 ноября, 17:00 МСК — Сибирский стрим. После /start пришлю напоминание за сутки и ссылку, когда эфир действительно начнётся. /stop — отписаться. Храню только ID чата и состояние подписки; удалю их после события.');return json({ok:true});}
  let status;try{status=await this.status();}catch{status={state:'waiting'};}
  if(status.state==='ended'||now>START+6*3600000){await this.send(input.chatId,'Этот Сибирский стрим уже завершился 💋 Новости и запись ищи на странице приглашения.');return json({ok:true});}
  if(!old&&(await this.ctx.storage.list({prefix:'sub:',limit:1001})).size>=1000){await this.send(input.chatId,'Пока не могу добавить подписку. Сохрани приглашение в календарь — ссылка есть на странице 💋');return json({ok:true});}
  const sub={chatId:input.chatId,subscribedAt:old?.subscribedAt||now,lastUpdate:input.id,lastAction:now,day:old?.day||'pending',live:old?.live||'pending'};
  if(status.state==='live')sub.live='sent';
  await this.ctx.storage.put(key,sub);await this.ctx.storage.delete('stop:'+input.chatId);
  const text=status.state==='live'?'Мы уже в эфире 💋 Заходи с выключенными камерой и микрофоном.':now<REMINDER?'Ты в списке 💋 Сибирский стрим — 27 ноября, 17:00 МСК. Напомню за сутки и пришлю ссылку, когда начнём. Отписаться: /stop':'Ты в списке 💋 Сибирский стрим — 27 ноября, 17:00 МСК. Пришлю ссылку, когда начнём. Отписаться: /stop';
  const result=await this.send(input.chatId,text,status.state==='live'?status.joinUrl:undefined);
  if(result.blocked)await this.ctx.storage.delete(key);
  return json({ok:true});
 }
 async tick(){
  const now=Date.now();if(now>EXPIRES){await this.ctx.storage.deleteAll();return;}
  const stopped=await this.ctx.storage.list({prefix:'stop:'});for(const [key,value]of stopped)if(value.at<now-86400000)await this.ctx.storage.delete(key);
  const subscriptions=await this.ctx.storage.list({prefix:'sub:'});if(!subscriptions.size)return;
  let status;try{status=await this.status();}catch{await this.ctx.storage.setAlarm(now+60000);return;}
  if(status.state==='ended')return;
  let count=0,next=null;
  for(const [key,sub]of subscriptions){
   const kind=status.state==='live'&&sub.live==='pending'?'live':status.state==='waiting'&&now>=REMINDER&&now<START&&sub.subscribedAt<REMINDER&&sub.day==='pending'?'day':null;
   if(!kind)continue;
   if(sub.retryAt>now){next=Math.min(next??Infinity,sub.retryAt);continue;}
   if(count>=15){next=Math.min(next??Infinity,now+1500);continue;}
   count++;
   // Claim before the external send. An ambiguous timeout stays uncertain rather than sending twice.
   sub[kind]='sending';await this.ctx.storage.put(key,sub);
   const result=await this.send(sub.chatId,kind==='day'?'Завтра в 17:00 МСК — Сибирский стрим 💋 Ника, Саян и Антон Гладков. Ссылку в комнату пришлю, когда начнём.':'Мы начали Сибирский стрим 💋 Ника, Саян и Антоха уже здесь. Подключайся с выключенными камерой и микрофоном.',kind==='live'?status.joinUrl:undefined);
   if(result.blocked){await this.ctx.storage.delete(key);continue;}
   if(result.ok){sub[kind]='sent';delete sub.retryAt;}
   else if(result.uncertain){sub[kind]='uncertain';}
   else{sub[kind]='pending';sub.retryAt=Date.now()+result.retry*1000;next=Math.min(next??Infinity,sub.retryAt);}
   await this.ctx.storage.put(key,sub);
  }
  if(next)await this.ctx.storage.setAlarm(Math.max(Date.now()+1500,next));
 }
}
