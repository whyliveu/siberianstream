import {strict as assert} from 'node:assert';
import worker,{StreamBot,START,REMINDER,webhookSecret,validMeet} from '../src/worker.mjs';
class Storage {
 constructor(){this.values=new Map();this.alarm=null;}
 async get(k){return structuredClone(this.values.get(k));}
 async put(k,v){this.values.set(k,structuredClone(v));}
 async delete(k){return this.values.delete(k);}
 async list({prefix,limit=10000}){return new Map([...this.values].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));}
 async setAlarm(t){this.alarm=t;}
 async deleteAll(){this.values.clear();}
}
const realNow=Date.now,realFetch=globalThis.fetch;
let now=REMINDER-3600000,stream={state:'waiting',joinUrl:null},sent=[],outcome='ok',registration=0;
Date.now=()=>now;
globalThis.fetch=async(url,options)=>{
 if(String(url).includes('/sendMessage')){const body=JSON.parse(options.body);sent.push(body);if(outcome==='blocked')return Response.json({ok:false,error_code:403});if(outcome==='retry')return Response.json({ok:false,error_code:429,parameters:{retry_after:10}});if(outcome==='timeout')throw Error('private transport error');return Response.json({ok:true,result:{message_id:sent.length}});}
 if(String(url).includes('/getMe'))return Response.json({ok:true,result:{username:'mashkasad_streambot'}});
 if(String(url).includes('/getWebhookInfo'))return Response.json({ok:true,result:{url:''}});
 if(String(url).includes('/setWebhook')){registration++;return Response.json({ok:true,result:true});}
 if(String(url).includes('/setMyCommands'))return Response.json({ok:true,result:true});
 return Response.json(stream);
};
const env={TELEGRAM_BOT_TOKEN:'12345:test-only-not-a-real-token',BOT_USERNAME:'mashkasad_streambot',SITE_URL:'https://example.org/',STATUS_URL:'https://example.org/status.json',WEBHOOK_URL:'https://example.org/api/telegram/webhook',ASSETS:{fetch:async()=>new Response('static invitation')}};
const storage=new Storage(),bot=new StreamBot({storage},env);env.STREAM_BOT={idFromName:x=>x,get:()=>({fetch:r=>bot.fetch(r)})};
const update=(id,chatId=1,text='/start')=>bot.fetch(new Request('https://internal/update',{method:'POST',body:JSON.stringify({id,chatId,text})}));
try{
 assert.equal(await(await worker.fetch(new Request('https://example.org/'),env)).text(),'static invitation');
 assert.equal((await worker.fetch(new Request('https://example.org/api/telegram/webhook',{method:'POST',body:'{}'}),env)).status,403);
 await bot.configure();assert.equal(registration,1);await bot.configure();assert.equal(registration,1);
 assert.equal((await(await bot.fetch(new Request('https://internal/health'))).json()).ready,true);
 const secret=await webhookSecret(env.TELEGRAM_BOT_TOKEN);
 const webhook=body=>worker.fetch(new Request('https://example.org/api/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:JSON.stringify(body)}),env);
 await webhook({update_id:1,message:{chat:{id:1,type:'private'},text:'/start sibirskiy-strim-2026-11-27'}});
 assert.equal(sent.length,1);assert((await storage.get('sub:1')).subscribedAt<REMINDER);
 await update(1);assert.equal(sent.length,1,'duplicate webhook suppressed');
 await webhook({update_id:2,message:{chat:{id:50,type:'group'},text:'/start'}});assert.equal(await storage.get('sub:50'),undefined);
 const oversize=await worker.fetch(new Request('https://example.org/api/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':secret},body:'x'.repeat(20000)}),env);assert.equal(oversize.status,400);
 now=REMINDER;await bot.tick();assert.equal(sent.length,2);assert(sent[1].text.startsWith('Завтра'));await bot.tick();assert.equal(sent.length,2);
 now+=4000;await update(3,2);assert.equal(sent.length,3);await bot.tick();assert.equal(sent.length,3,'late subscribers do not receive yesterday-style reminders');
 now=START-60000;stream={state:'live',joinUrl:'https://evil.example/'};await storage.delete('stream-status');await bot.tick();assert.equal(sent.length,3,'invalid room URL fails closed');
 now=START+1000;stream={state:'live',joinUrl:'https://meet.google.com/abc-defg-hij'};await storage.delete('stream-status');await bot.tick();assert.equal(sent.length,5);assert.equal(sent[4].reply_markup.inline_keyboard[0][0].url,stream.joinUrl);await bot.tick();assert.equal(sent.length,5);
 await update(4,3);assert(sent.at(-1).text.startsWith('Мы уже'));await bot.tick();assert.equal(sent.length,6,'late live join is not notified twice');
 await update(5,1,'/stop');assert.equal(await storage.get('sub:1'),undefined);const stoppedCount=sent.length;await update(5,1,'/stop');await update(4,1);assert.equal(sent.length,stoppedCount,'duplicate and delayed updates cannot reverse unsubscribe');
 now+=4000;await update(6,4);outcome='retry';const sub=await storage.get('sub:4');sub.live='pending';await storage.put('sub:4',sub);await bot.tick();assert.equal((await storage.get('sub:4')).live,'pending');assert(storage.alarm>now);outcome='ok';now+=11000;await bot.tick();assert.equal((await storage.get('sub:4')).live,'sent');
 now+=4000;await update(7,5);const five=await storage.get('sub:5');five.live='pending';await storage.put('sub:5',five);outcome='timeout';await bot.tick();assert.equal((await storage.get('sub:5')).live,'uncertain');const ambiguousCount=sent.length;await bot.tick();assert.equal(sent.length,ambiguousCount,'ambiguous send is not automatically duplicated');outcome='ok';
 // Batched fan-out continues through alarms without exceeding the Worker fetch budget.
 for(let i=100;i<117;i++)await storage.put('sub:'+i,{chatId:i,subscribedAt:REMINDER-1,lastUpdate:1,day:'sent',live:'pending'});
 const before=sent.length;await bot.tick();assert.equal(sent.length-before,15);await bot.alarm();assert.equal(sent.length-before,17);
 await storage.put('sub:700',{chatId:700,subscribedAt:REMINDER-1,lastUpdate:1,day:'sent',live:'pending'});outcome='blocked';await bot.tick();assert.equal(await storage.get('sub:700'),undefined,'blocked chat is removed');outcome='ok';
 const restarted=new StreamBot({storage},env);const restartCount=sent.length;await restarted.update({id:7,chatId:5,text:'/start'});await restarted.tick();assert.equal(sent.length,restartCount,'ledger survives an object restart');
 stream={state:'ended',joinUrl:null};now+=11000;await storage.delete('stream-status');await bot.tick();const endedCount=sent.length;await bot.tick();assert.equal(sent.length,endedCount);
 now=START+7*3600000;stream={state:'live',joinUrl:'https://meet.google.com/abc-defg-hij'};await storage.delete('stream-status');await storage.put('sub:900',{chatId:900,subscribedAt:REMINDER-1,lastUpdate:1,day:'sent',live:'pending'});const lateCount=sent.length;await bot.tick();assert.equal(sent.length,lateCount,'stale live flag cannot notify people after the event window');
 now=START+11*86400000;await bot.tick();assert.equal(storage.values.size,0,'personal data expires');
 assert(validMeet('https://meet.google.com/abc-defg-hij'));assert(!validMeet('https://meet.google.com.evil.test/abc-defg-hij'));
 console.log('PASS: protected webhook, body limit, private-chat consent, restart-safe dedup, scheduled reminder, late subscription, verified live link, unsubscribe, retry, ambiguous-send suppression, batch continuation, data expiry and automatic setup.');
}finally{Date.now=realNow;globalThis.fetch=realFetch;}
