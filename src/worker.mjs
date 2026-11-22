const EVENT = 'sibirskiy-strim-2026-11-27';
export const START = Date.parse('2026-11-27T17:00:00+03:00');
export const REMINDER = START - 86400000;
export const HOUR_REMINDER = START - 3600000;
const DAY_REMINDER_END = Date.parse('2026-11-27T00:00:00+03:00');
const PROFILE_VERSION = 'star-27nov-v1';
const DONATION_URL = 'https://www.donationalerts.com/r/mashkasad';
export const COPY = {
 day: 'Йоу! Завтра, <b>27 ноября в 17:00 по МСК</b>, встречаемся на Сибирском стриме с Никой, Саяном и Антоном Гладковым.\n\nПоболтаем про брейк, Сибирь и то, как из маленького зала вырастают большие истории)\n\nКстати, в лайве выберем <b>три самых интересных вопроса</b>. Их авторам доставим домой <b>футболки In Da Motion с росписью Ники и Саяна</b>. Так что готовь вопросы)\n\nЗавтра связь!',
 hour: 'Йоу, <b>через час начинаем!</b>\n\nВ 17:00 по МСК — Сибирский стрим с Никой, Саяном и Антоном Гладковым.\n\nГотовь вопросы, скоро пришлю ссылку в комнату)',
 live: 'Йоу, <b>мы начали!</b>\n\nНика, Саян, Антон и я уже в комнате. Залетай)\n\nКамеру и микрофон оставь выключенными, а вопросы кидай в чат. Авторам трёх самых интересных — футболки с росписью Ники и Саяна!'
};
export function welcomeText(now) {
 const plan=now<REMINDER?'Шарик крутится быстро, поэтому пришлю тебе напоминание за день и за час до начала стрима, окей?':now<HOUR_REMINDER?'Шарик крутится быстро, поэтому пришлю тебе напоминание за час до начала стрима, окей?':'Уже скоро начинаем! Пришлю ссылку в комнату, когда стартуем.';
 return 'Йоу! Проведём <b>Сибирский стрим</b> с Никой, Саяном и Антоном Гладковым <b>27 ноября в 17:00 по МСК</b>.\n\n'+plan+'\n\nСвязь)\n\np.s. можешь задонатить любовью в рублях <a href="'+DONATION_URL+'">вот тут</a>)\n\nОтписаться — /stop.';
}
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
  const multipart=body instanceof FormData;
  const r=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:multipart?undefined:{'Content-Type':'application/json'},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
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
  if(path==='/health'){const setup=await this.ctx.storage.get('setup');const fingerprint=await webhookSecret(this.env.TELEGRAM_BOT_TOKEN);return json({ready:setup?.fingerprint===fingerprint&&setup?.verifiedAt>Date.now()-600000,username:this.env.BOT_USERNAME,profileReady:setup?.profileVersion===PROFILE_VERSION,reminders:['day','hour','live'],error:await this.ctx.storage.get('setup-error')});}
  if(path==='/update')return this.update(await request.json());
  if(path==='/tick'){try{await this.configure();await this.tick();return json({ok:true});}catch(error){const reason=/^[a-zA-Z_]{1,80}$/.test(error.message)?error.message:'temporarily_unavailable';await this.ctx.storage.put('setup-error',reason);return json({ok:false,error:reason},503);}}
  return json({error:'not_found'},404);
 });}
 alarm(){return this.serial(()=>this.tick());}
 async configure(){
  if(Date.now()>EXPIRES)return;
  const fingerprint=await webhookSecret(this.env.TELEGRAM_BOT_TOKEN),old=await this.ctx.storage.get('setup');
  if(old?.fingerprint===fingerprint&&old?.profileVersion===PROFILE_VERSION&&old?.verifiedAt>Date.now()-300000)return;
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
  if(old?.fingerprint!==fingerprint||old?.profileVersion!==PROFILE_VERSION){
   const changes=[['setMyName',{name:'Сибирский стрим 27nov'}],['setMyDescription',{description:'Йоу! 27 ноября в 17:00 по МСК — Сибирский стрим с Никой, Саяном и Антоном Гладковым. Брейк, морозная хип-хоп-культура и три футболки за самые интересные вопросы в лайве)\n\nЖми «Старт» — напомню за сутки, за час и пришлю ссылку, когда начнём.'}],['setMyShortDescription',{short_description:'27 ноября · 17:00 МСК. Ника, Саян и Антон Гладков. Напоминания и ссылка на Сибирский стрим.'}]];
   for(const [method,body]of changes){if(!(await telegram(this.env,method,body)).ok)throw new Error('profile_'+method+'_failed');}
   const asset=await this.env.ASSETS.fetch(new Request(new URL('/assets/stream-bot-star-v1.jpg',webhook)));
   if(!asset.ok||!asset.headers.get('content-type')?.startsWith('image/jpeg'))throw new Error('profile_asset_unavailable');
   const photo=new FormData();photo.set('photo',JSON.stringify({type:'static',photo:'attach://avatar'}));photo.set('avatar',new Blob([await asset.arrayBuffer()],{type:'image/jpeg'}),'stream-avatar.jpg');
   if(!(await telegram(this.env,'setMyProfilePhoto',photo)).ok)throw new Error('profile_photo_failed');
  }
  await this.ctx.storage.put('setup',{fingerprint,url:webhook,verifiedAt:Date.now(),profileVersion:PROFILE_VERSION});
  await this.ctx.storage.delete('setup-error');
 }
 async status(){
  const cached=await this.ctx.storage.get('stream-status');if(cached?.at>Date.now()-10000)return cached.value;
  const r=await fetch(this.env.STATUS_URL,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('status_unavailable');
  const value=await r.json();if(!['waiting','live','ended'].includes(value.state)||(value.state==='live'&&!validMeet(value.joinUrl)))throw new Error('invalid_stream_status');
  await this.ctx.storage.put('stream-status',{at:Date.now(),value});return value;
 }
 async send(chatId,text,joinUrl,support=false){
  const site=this.env.SITE_URL||DEFAULT_SITE;
  const buttons=[[{text:joinUrl?'Подключиться к стриму':'Открыть приглашение',url:joinUrl||site}]];
  if(support)buttons.push([{text:'Поддержать любовью в рублях',url:DONATION_URL}]);
  return telegram(this.env,'sendMessage',{chat_id:chatId,text,parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:buttons}});
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
  if(command==='/help'){await this.send(input.chatId,'Йоу! 27 ноября в 17:00 по МСК — Сибирский стрим с Никой, Саяном и Антоном Гладковым.\n\n/start — подписаться на напоминания за сутки, за час и на ссылку в момент начала. Если подпишешься позже, пришлю только оставшиеся сообщения.\n/stop — отписаться.\n\nХраню только ID чата и состояние подписки; удалю их после события.');return json({ok:true});}
  let status;try{status=await this.status();}catch{status={state:'waiting'};}
  if(status.state==='ended'||now>START+6*3600000){await this.send(input.chatId,'Этот Сибирский стрим уже завершился 💋 Новости и запись ищи на странице приглашения.');return json({ok:true});}
  if(!old&&(await this.ctx.storage.list({prefix:'sub:',limit:1001})).size>=1000){await this.send(input.chatId,'Пока не могу добавить подписку. Сохрани приглашение в календарь — ссылка есть на странице 💋');return json({ok:true});}
  const sub={chatId:input.chatId,subscribedAt:old?.subscribedAt||now,lastUpdate:input.id,lastAction:now,day:old?.day||'pending',hour:old?.hour||'pending',live:old?.live||'pending'};
  if(status.state==='live')sub.live='sent';
  await this.ctx.storage.put(key,sub);await this.ctx.storage.delete('stop:'+input.chatId);
  const text=status.state==='live'?'Мы уже в эфире! Ника, Саян, Антон и я — в комнате. Залетай с выключенными камерой и микрофоном) Вопросы — в чат.':welcomeText(now);
  const result=await this.send(input.chatId,text,status.state==='live'?status.joinUrl:undefined,status.state!=='live');
  if(result.blocked)await this.ctx.storage.delete(key);
  return json({ok:true});
 }
 async tick(){
  const now=Date.now();if(now>EXPIRES){await this.ctx.storage.deleteAll();return;}
  if(now>START+6*3600000)return;
  const stopped=await this.ctx.storage.list({prefix:'stop:'});for(const [key,value]of stopped)if(value.at<now-86400000)await this.ctx.storage.delete(key);
  const subscriptions=await this.ctx.storage.list({prefix:'sub:'});if(!subscriptions.size)return;
  let status;try{status=await this.status();}catch{await this.ctx.storage.setAlarm(now+60000);return;}
  if(status.state==='ended')return;
  let count=0,next=null;
  for(const [key,sub]of subscriptions){
   const hourPending=!sub.hour||sub.hour==='pending';
   const kind=status.state==='live'&&sub.live==='pending'?'live':status.state==='waiting'&&now>=HOUR_REMINDER&&now<START&&sub.subscribedAt<HOUR_REMINDER&&hourPending?'hour':status.state==='waiting'&&now>=REMINDER&&now<DAY_REMINDER_END&&sub.subscribedAt<REMINDER&&sub.day==='pending'?'day':null;
   if(!kind)continue;
   if(sub.retryAt>now){next=Math.min(next??Infinity,sub.retryAt);continue;}
   if(count>=15){next=Math.min(next??Infinity,now+1500);continue;}
   count++;
   // Claim before the external send. An ambiguous timeout stays uncertain rather than sending twice.
   sub[kind]='sending';await this.ctx.storage.put(key,sub);
   const result=await this.send(sub.chatId,COPY[kind],kind==='live'?status.joinUrl:undefined);
   if(result.blocked){await this.ctx.storage.delete(key);continue;}
   if(result.ok){sub[kind]='sent';delete sub.retryAt;}
   else if(result.uncertain){sub[kind]='uncertain';}
   else{sub[kind]='pending';sub.retryAt=Date.now()+result.retry*1000;next=Math.min(next??Infinity,sub.retryAt);}
   await this.ctx.storage.put(key,sub);
  }
  if(next)await this.ctx.storage.setAlarm(Math.max(Date.now()+1500,next));
 }
}

