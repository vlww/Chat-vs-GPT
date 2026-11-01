import 'dotenv/config';
import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { Server } from 'socket.io';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

type Player={id:string,name:string,avatar?:string,ai?:boolean,npc?:boolean,alive:boolean,joinedAt:number};
type Chat={id:string,name:string,text:string,at:number,kind:'player'|'system'|'ai',simulated?:boolean};
type Game={channel:string,broadcasterId?:string,mode:'simulation'|'twitch',phase:'lobby'|'discussion'|'voting'|'reveal'|'over',round:number,players:Player[],eliminated:string[],accusations:Record<string,string>,accusationEvents:{from:string,target:string,round:number,at:number}[],votes:Record<string,string>,voteHistory:{from:string,target:string,round:number}[],chat:Chat[],deadline:number|null,settings:{minPlayers:number,maxPlayers:number,discussionSeconds:number},aiSecret:{personality:string,objective:string},aiBusy:boolean,aiLast:number,summary:string[],recap?:Record<string,unknown>};
const app=express(); app.use(express.json()); const server=createHttpServer(app); const io=new Server(server,{cors:{origin:true,credentials:true}});
const PORT=Number(process.env.PORT||3000); const games=new Map<string,Game>(); const streamerSessions=new Map<string,{userId:string,login:string,displayName:string,avatar:string}>(); const timers=new Map<string,NodeJS.Timeout>(); const npcTimers=new Map<string,NodeJS.Timeout>();
let botAccessToken=process.env.TWITCH_BOT_OAUTH_TOKEN||'';let botRefreshToken=process.env.TWITCH_BOT_REFRESH_TOKEN||'';let botUserId=process.env.TWITCH_BOT_USER_ID||'';let botLogin=process.env.TWITCH_BOT_USERNAME?.toLowerCase()||'';let eventSubSocket:WebSocket|null=null;let eventSubSessionId='';let eventSubReady=false;let eventSubRetry:NodeJS.Timeout|null=null;const chatSubscriptions=new Map<string,string>();const seenEventIds=new Set<string>();let tokenRefresh:Promise<void>|null=null;
const personalities=['The Confident One','The People Pleaser','The Quiet One','The Conspiracy Theorist','The Manipulator'];
const objectives=['Get the most influential player to defend you','Get one specific player eliminated','Survive a round without being accused','Make two players suspect each other'];
const pick=<T,>(xs:T[])=>xs[Math.floor(Math.random()*xs.length)];
const cookieSecret=process.env.SESSION_SECRET||'development-only-change-me';
function sign(value:string){return crypto.createHmac('sha256',cookieSecret).update(value).digest('hex')}
function session(req:express.Request){const raw=req.headers.cookie?.split('; ').find(x=>x.startsWith('cvg_session='))?.split('=')[1]; if(!raw)return null; const [id,sig]=decodeURIComponent(raw).split('.'); return id&&sig&&sign(id)===sig?streamerSessions.get(id)||null:null;}
function canManage(req:express.Request,g:Game){return g.mode==='simulation'||session(req)?.login===g.channel;}
function publicChat(m:Chat){return {...m,kind:m.kind==='system'?'system':'player'};}
function state(g:Game){return {channel:g.channel,mode:g.mode,phase:g.phase,round:g.round,players:g.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,alive:p.alive,npc:p.npc})),eliminated:g.eliminated,accusations:g.accusations,votes:Object.fromEntries(Object.keys(g.votes).map(k=>[k,'cast'])),chat:g.chat.slice(-80).map(publicChat),deadline:g.deadline,settings:g.settings,recap:g.recap, ...(g.phase==='over'?{reveal:g.aiSecret}:{})};}
function emit(g:Game){io.to(g.channel).emit('state',state(g));}
function msg(g:Game,name:string,text:string,kind:Chat['kind']='player',simulated=false){const item={id:crypto.randomUUID(),name,text:text.slice(0,500),at:Date.now(),kind,simulated};g.chat.push(item);g.chat=g.chat.slice(-300);io.to(g.channel).emit('chat',publicChat(item));}
function sayTwitch(g:Game,text:string){if(g.mode==='twitch'&&g.broadcasterId&&botAccessToken&&botUserId){sendChatMessage(g,text).catch(e=>console.error('Twitch send:',e.message));}}
function system(g:Game,text:string,simulated=false){msg(g,'SYSTEM',text,'system',simulated);if(!simulated)sayTwitch(g,text);}
function newGame(channel:string,mode:Game['mode'],settings?:Partial<Game['settings']>):Game{const integer=(v:unknown,fallback:number)=>Number.isFinite(Number(v))?Math.round(Number(v)):fallback;const minPlayers=Math.max(2,Math.min(10,integer(settings?.minPlayers,4)));const maxPlayers=Math.max(minPlayers+1,Math.min(16,integer(settings?.maxPlayers,12)));const discussionSeconds=Math.max(30,Math.min(300,integer(settings?.discussionSeconds,90)));return {channel:channel.toLowerCase(),mode,phase:'lobby',round:0,players:[],eliminated:[],accusations:{},accusationEvents:[],votes:{},voteHistory:[],chat:[],deadline:null,settings:{minPlayers,maxPlayers,discussionSeconds},aiSecret:{personality:pick(personalities),objective:pick(objectives)},aiBusy:false,aiLast:0,summary:[]};}
function schedule(g:Game){const old=timers.get(g.channel);if(old)clearTimeout(old); if(!g.deadline)return; const delay=Math.max(0,g.deadline-Date.now()); const t=setTimeout(()=>{if(g.phase==='discussion')startVoting(g);else if(g.phase==='voting')finishVote(g);else if(g.phase==='reveal')startNextRound(g);},delay); timers.set(g.channel,t);}
function npcTurn(g:Game){if(g.mode!=='simulation'||g.phase!=='discussion')return;const speakers=g.players.filter(p=>p.alive&&p.npc);if(!speakers.length)return;const speaker=pick(speakers);const targets=g.players.filter(p=>p.alive&&p.id!==speaker.id);const target=pick(targets);const lines=[`I keep coming back to ${target?.name}. They're too calm.`,`Wait, ${target?.name} changed their story. Did anyone else catch that?`,`I'm watching ${target?.name}. Something feels off.`,`Okay, who has actually said anything useful?`,`That vote is going to tell us a lot.`,`I don't trust how quickly ${target?.name} is pointing fingers.`];msg(g,speaker.name,pick(lines),'player',true);if(target&&Math.random()<.42){g.accusations[speaker.id]=target.id;g.accusationEvents.push({from:speaker.id,target:target.id,round:g.round,at:Date.now()});}emit(g);const timer=setTimeout(()=>npcTurn(g),7000+Math.floor(Math.random()*5000));npcTimers.set(g.channel,timer);}
function begin(g:Game){if(g.phase!=='lobby'||g.players.length<g.settings.minPlayers)return false;const aiName=(botLogin||'chat_vs_gpt').toLowerCase();g.players.push({id:aiName,name:aiName,ai:true,alive:true,joinedAt:Date.now()});g.phase='discussion';g.round=1;g.deadline=Date.now()+g.settings.discussionSeconds*1000;system(g,'The first round is underway. One player is secretly AI. Talk it out, then vote.');if(!anthropicApiKey&&g.mode==='simulation')system(g,'Add an Anthropic API key to enable the hidden AI player.');emit(g);schedule(g);if(g.mode==='simulation')npcTurn(g);return true;}
function startVoting(g:Game){if(g.phase!=='discussion')return;const npcTimer=npcTimers.get(g.channel);if(npcTimer)clearTimeout(npcTimer);npcTimers.delete(g.channel);g.phase='voting';g.deadline=Date.now()+45_000;for(const npc of g.players.filter(p=>p.alive&&p.npc)){const accused=Object.entries(g.accusations).filter(([from])=>from!==npc.id).map(([,to])=>to).filter(id=>g.players.find(p=>p.id===id)?.alive);const choices=g.players.filter(p=>p.alive&&p.id!==npc.id).map(p=>p.id);const target=accused.length&&Math.random()<.65?pick(accused):pick(choices);if(target)g.votes[npc.id]=target;}system(g,'Discussion is closed. Voting is open. Choose a suspect or use !vote username.');emit(g);schedule(g);}
function finishVote(g:Game){if(g.phase!=='voting')return;const tallies:Record<string,number>={};for(const target of Object.values(g.votes))tallies[target]=(tallies[target]||0)+1;let winner:string|undefined;let max=0;for(const [id,count] of Object.entries(tallies)){if(count>max){max=count;winner=id;}else if(count===max)winner=undefined;}
 if(!winner){g.phase='reveal';g.deadline=Date.now()+5000;system(g,'The vote is tied. Nobody is eliminated.');emit(g);schedule(g);return;}
 const target=g.players.find(p=>p.id===winner);if(!target){startNextRound(g);return;}target.alive=false;g.eliminated.push(target.id);const wasAi=!!target.ai;system(g,`${target.name} was eliminated. ${wasAi?'They were the AI. Humans win!':'They were human.'}`);
 if(wasAi||g.players.filter(p=>p.alive&&!p.ai).length<=1){g.phase='over';g.deadline=null;g.recap=makeRecap(g);system(g,wasAi?'Game over. The humans found the impostor.':'Game over. The AI survived to the final two. The AI wins.');io.to(g.channel).emit('state',state(g));void unsubscribeFromChat(g);return;}
 g.phase='reveal';g.deadline=Date.now()+6500;emit(g);schedule(g);
}
function startNextRound(g:Game){g.round++;g.phase='discussion';g.accusations={};g.votes={};g.deadline=Date.now()+g.settings.discussionSeconds*1000;system(g,`Round ${g.round}: discussion is open. Who is still acting suspicious?`);emit(g);schedule(g);if(g.mode==='simulation')npcTurn(g);}
function makeRecap(g:Game){const ai=g.players.find(p=>p.ai)!;const incoming=g.accusationEvents.reduce<Record<string,number>>((a,e)=>(a[e.target]=(a[e.target]||0)+1,a),{});const firstAiAcc=g.accusationEvents.find(e=>e.target===ai.id);const mostAccused=Object.entries(incoming).sort((a,b)=>b[1]-a[1])[0]?.[0];return {aiName:ai.name,firstAccuser:firstAiAcc?g.players.find(p=>p.id===firstAiAcc.from)?.name||null:null,mostAccused:mostAccused?g.players.find(p=>p.id===mostAccused)?.name||null:null,roundsSurvived:g.round,correctVotes:g.voteHistory.filter(v=>v.target===ai.id).map(v=>g.players.find(p=>p.id===v.from)?.name).filter(Boolean),personality:g.aiSecret.personality,objective:g.aiSecret.objective,finalVotes:g.votes};}
function validPlayer(g:Game,name:string){return g.players.find(p=>p.alive&&p.name.toLowerCase()===name.replace(/^@/,'').toLowerCase());}
const anthropicApiKey=process.env.ANTHROPIC_API_KEY||'';
async function think(g:Game){if(!anthropicApiKey||g.aiBusy||Date.now()-g.aiLast<12000||g.phase!=='discussion')return;g.aiBusy=true;g.aiLast=Date.now();try{const living=g.players.filter(p=>p.alive);const recent=g.chat.filter(m=>m.kind!=='system').slice(-24).map(m=>`${m.name}: ${m.text}`).join('\n');const events=g.accusationEvents.slice(-18).map(e=>`${g.players.find(p=>p.id===e.from)?.name} accused ${g.players.find(p=>p.id===e.target)?.name} (round ${e.round})`).join('; ');const prompt=`Round ${g.round}. Living players: ${living.map(p=>p.name).join(', ')}. Recent accusations: ${events||'none'}. Current accusations: ${JSON.stringify(g.accusations)}. Recent conversation:\n${recent}\nShould you say something now?`;const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':anthropicApiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-haiku-4-5-20251001',max_tokens:120,system:`You are a human-like player in a social deduction game secretly playing for the AI side. Public messages must never reveal you are AI or mention your hidden goal. Write brief casual Twitch chat (usually one sentence, lowercase is fine). You may stay silent. Choose whether to speak strategically, not every turn. Personality: ${g.aiSecret.personality}. Secret objective: ${g.aiSecret.objective}. Keep strategy private. Respond only as JSON with this shape: {"speak":boolean,"message":string}.`,messages:[{role:'user',content:prompt}]})});const result=await response.json() as any;if(!response.ok)throw Error(`Anthropic API request failed (${response.status}): ${result.error?.message||'unknown error'}`);const content=Array.isArray(result.content)?result.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join('\n'):'';const jsonText=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const obj=JSON.parse(jsonText||'{}');if(g.phase==='discussion'&&obj.speak&&typeof obj.message==='string'&&obj.message.length<220&&!/(chatgpt|language model|as an ai|i am an ai|i'm an ai|secret objective)/i.test(obj.message)){msg(g,(g.players.find(p=>p.ai)?.name||'chat_vs_gpt'),obj.message,'ai',g.mode==='simulation');sayTwitch(g,obj.message);}}catch(e){console.error('AI turn failed:',e);}finally{g.aiBusy=false;emit(g);}}
function handle(g:Game,name:string,text:string,sim=false){if(name.toLowerCase()===botLogin)return;const cmd=text.trim().match(/^!(join|leave|accuse|vote|players|status|help)\b\s*(.*)$/i); if(!cmd){if(g.phase==='discussion'){msg(g,name,text,'player',sim);void think(g);}return;}const action=cmd[1].toLowerCase(),arg=cmd[2].trim();const player=g.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
 if(action==='help'){system(g,'Commands: !join · !leave · !players · !status · !accuse username · !vote username',sim);return;}
 if(action==='status'){system(g,`Phase: ${g.phase} · round ${g.round||'lobby'} · ${g.players.filter(p=>p.alive).length} alive`,sim);return;}
 if(action==='players'){system(g,`Players: ${g.players.filter(p=>p.alive).map(p=>p.name).join(', ')||'none yet'}`,sim);return;}
 if(action==='join'){if(g.phase!=='lobby')return system(g,'The lobby is closed. Catch the next game!',sim);if(player)return;if(g.players.length>=g.settings.maxPlayers-1)return system(g,'Lobby is full.',sim);g.players.push({id:name.toLowerCase(),name,alive:true,joinedAt:Date.now()});system(g,`${name} joined (${g.players.length}/${g.settings.maxPlayers-1})`,sim);emit(g);return;}
 if(action==='leave'){if(g.phase!=='lobby'||!player)return;g.players=g.players.filter(p=>p!==player);system(g,`${name} left the lobby.`,sim);emit(g);return;}
 if(action==='accuse'){if(g.phase!=='discussion'||!player?.alive||!arg)return;const target=validPlayer(g,arg);if(!target||target.id===player.id)return;g.accusations[player.id]=target.id;g.accusationEvents.push({from:player.id,target:target.id,round:g.round,at:Date.now()});system(g,`${name} suspects ${target.name}.`,sim);emit(g);void think(g);return;}
 if(action==='vote'){if(g.phase!=='voting'||!player?.alive||!arg||g.votes[player.id])return;const target=validPlayer(g,arg);if(!target||target.id===player.id)return;g.votes[player.id]=target.id;g.voteHistory.push({from:player.id,target:target.id,round:g.round});system(g,`${name} locked in a vote.`,sim);emit(g);return;}
}
const EVENTSUB_URL='wss://eventsub.wss.twitch.tv/ws';
function persistEnvValue(key:string,value:string){
 if(!fs.existsSync('.env'))return;
 const contents=fs.readFileSync('.env','utf8');const line=new RegExp(`^${key}=.*$`,'m');
 const updated=line.test(contents)?contents.replace(line,`${key}=${value}`):`${contents.trimEnd()}\n${key}=${value}\n`;
 fs.writeFileSync('.env',updated,{mode:0o600});
}
async function refreshBotAccessToken(){
 if(tokenRefresh)return tokenRefresh;
 if(!botRefreshToken||!process.env.TWITCH_CLIENT_ID||!process.env.TWITCH_CLIENT_SECRET)throw Error('A Twitch bot refresh token and app secret are required to refresh the bot session.');
 tokenRefresh=(async()=>{
  const response=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID!,client_secret:process.env.TWITCH_CLIENT_SECRET!,grant_type:'refresh_token',refresh_token:botRefreshToken})});
  const body=await response.json() as any;if(!response.ok||!body.access_token)throw Error(`Twitch token refresh failed (${response.status}).`);
  botAccessToken=body.access_token;process.env.TWITCH_BOT_OAUTH_TOKEN=botAccessToken;persistEnvValue('TWITCH_BOT_OAUTH_TOKEN',botAccessToken);
  if(body.refresh_token){botRefreshToken=body.refresh_token;process.env.TWITCH_BOT_REFRESH_TOKEN=botRefreshToken;persistEnvValue('TWITCH_BOT_REFRESH_TOKEN',botRefreshToken);}
 })().finally(()=>{tokenRefresh=null;});
 return tokenRefresh;
}
async function twitchApi(endpoint:string,init:RequestInit={},retry=true):Promise<Response>{
 if(!botAccessToken||!process.env.TWITCH_CLIENT_ID)throw Error('Twitch bot credentials are not configured.');
 const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${botAccessToken}`);headers.set('Client-Id',process.env.TWITCH_CLIENT_ID);
 const response=await fetch(`https://api.twitch.tv/helix/${endpoint}`,{...init,headers});
 if(response.status===401&&retry&&botRefreshToken){await refreshBotAccessToken();return twitchApi(endpoint,init,false);}
 return response;
}
async function validateBotToken(){
 if(!botAccessToken)return;
 let response=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${botAccessToken}`}});
 if(response.status===401&&botRefreshToken){await refreshBotAccessToken();response=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${botAccessToken}`}});}
 const body=await response.json() as any;if(!response.ok)throw Error(`Twitch bot token validation failed (${response.status}).`);
 if(body.client_id!==process.env.TWITCH_CLIENT_ID)throw Error('The Twitch bot token belongs to a different Twitch app.');
 const required=['user:bot','user:read:chat','user:write:chat'];const missing=required.filter(scope=>!body.scopes?.includes(scope));if(missing.length)throw Error(`The Twitch bot token is missing scopes: ${missing.join(', ')}.`);
 botUserId=body.user_id;botLogin=String(body.login||botLogin).toLowerCase();
 if(process.env.TWITCH_BOT_USER_ID&&process.env.TWITCH_BOT_USER_ID!==botUserId)throw Error('TWITCH_BOT_USER_ID does not match the account that authorized the bot token.');
 if(process.env.TWITCH_BOT_USERNAME&&process.env.TWITCH_BOT_USERNAME.toLowerCase()!==botLogin)throw Error('TWITCH_BOT_USERNAME does not match the account that authorized the bot token.');
 process.env.TWITCH_BOT_USER_ID=botUserId;process.env.TWITCH_BOT_USERNAME=botLogin;
}
async function subscribeToChat(g:Game){
 if(!eventSubReady||!eventSubSessionId||!g.broadcasterId||chatSubscriptions.has(g.channel))return;
 const response=await twitchApi('eventsub/subscriptions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:g.broadcasterId,user_id:botUserId},transport:{method:'websocket',session_id:eventSubSessionId}})});
 const body=await response.json().catch(()=>({})) as any;
 if(response.status!==202)throw Error(body.message||`Twitch EventSub subscription failed (${response.status}).`);
 chatSubscriptions.set(g.channel,body.data?.[0]?.id||'');console.log(`EventSub listening to #${g.channel}.`);
}
async function unsubscribeFromChat(g:Game){
 const id=chatSubscriptions.get(g.channel);if(!id)return;chatSubscriptions.delete(g.channel);
 try{const response=await twitchApi(`eventsub/subscriptions?id=${encodeURIComponent(id)}`,{method:'DELETE'});if(!response.ok&&response.status!==404)console.error(`Twitch EventSub unsubscribe failed (${response.status}).`);}catch(error){console.error('Twitch EventSub unsubscribe:',(error as Error).message);}
}
async function sendChatMessage(g:Game,text:string){
 if(!g.broadcasterId||!botUserId)return;
 const response=await twitchApi('chat/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({broadcaster_id:g.broadcasterId,sender_id:botUserId,message:text.replace(/[\r\n]/g,' ').slice(0,450)})});
 const body=await response.json().catch(()=>({})) as any;
 if(!response.ok||body.data?.[0]?.is_sent===false)throw Error(body.data?.[0]?.drop_reason?.message||body.message||`Twitch chat send failed (${response.status}).`);
}
function connectEventSub(url=EVENTSUB_URL){
 if(!botAccessToken||(url===EVENTSUB_URL&&eventSubSocket&&(eventSubSocket.readyState===WebSocket.CONNECTING||eventSubSocket.readyState===WebSocket.OPEN)))return;
 const socket=new WebSocket(url);eventSubSocket=socket;
 socket.on('message',raw=>{let packet:any;try{packet=JSON.parse(raw.toString());}catch{return;}void handleEventSubPacket(packet);});
 socket.on('error',error=>console.error('Twitch EventSub:',error.message));
 socket.on('close',()=>{if(socket!==eventSubSocket)return;eventSubReady=false;eventSubSessionId='';chatSubscriptions.clear();if(eventSubRetry)clearTimeout(eventSubRetry);eventSubRetry=setTimeout(()=>connectEventSub(),5000);});
}
async function handleEventSubPacket(packet:any){
 const type=packet.metadata?.message_type;
 if(type==='session_welcome'){
  eventSubSessionId=packet.payload.session.id;eventSubReady=true;
  for(const game of games.values())if(game.mode==='twitch')try{await subscribeToChat(game);}catch(error){console.error(`EventSub subscribe #${game.channel}:`,(error as Error).message);}
  return;
 }
 if(type==='session_reconnect'){
  const reconnectUrl=packet.payload?.session?.reconnect_url;if(reconnectUrl)connectEventSub(reconnectUrl);return;
 }
 if(type==='notification'&&packet.metadata?.subscription_type==='channel.chat.message'){
  const eventId=packet.metadata.message_id;if(eventId&&seenEventIds.has(eventId))return;if(eventId){seenEventIds.add(eventId);if(seenEventIds.size>2000)seenEventIds.delete(seenEventIds.values().next().value!);}
  const event=packet.payload?.event;const game=games.get(String(event?.broadcaster_user_login||'').toLowerCase());
  if(game&&typeof event?.message?.text==='string')handle(game,event.chatter_user_name||event.chatter_user_login,event.message.text,false);
  return;
 }
 if(type==='revocation'){
  const id=packet.payload?.subscription?.id;for(const [channel,subId] of chatSubscriptions)if(subId===id)chatSubscriptions.delete(channel);
  console.error('Twitch revoked an EventSub subscription:',packet.payload?.subscription?.status||'unknown');
 }
}
async function startEventSub(){
 try{await validateBotToken();if(botAccessToken)connectEventSub();}
 catch(error){console.error('Twitch bot setup:',(error as Error).message);}
}
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.get('/api/session',(req,res)=>{const user=session(req);res.json({streamer:user?{userId:user.userId,login:user.login,displayName:user.displayName,avatar:user.avatar}:null});});
app.get('/auth/twitch',(req,res)=>{if(!process.env.TWITCH_CLIENT_ID||!process.env.TWITCH_REDIRECT_URI)return res.status(503).send('Twitch sign-in is not configured yet.');const state=crypto.randomBytes(24).toString('hex');res.cookie('cvg_oauth_state',`${state}.${sign(state)}`,{httpOnly:true,sameSite:'lax',secure:true,maxAge:600000,path:'/'});const params=new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID,redirect_uri:process.env.TWITCH_REDIRECT_URI,response_type:'code',state,force_verify:'true'});res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);});
app.get('/auth/twitch/callback',async(req,res)=>{const {code,state}=req.query;const saved=req.headers.cookie?.split('; ').find(x=>x.startsWith('cvg_oauth_state='))?.split('=')[1];const [savedState,savedSig]=saved?decodeURIComponent(saved).split('.'):[];res.clearCookie('cvg_oauth_state',{path:'/'});if(typeof state!=='string'||typeof code!=='string'||state!==savedState||!savedSig||sign(state)!==savedSig)return res.redirect('/?twitch_error=state');try{const tokenRes=await fetch('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.TWITCH_CLIENT_ID!,client_secret:process.env.TWITCH_CLIENT_SECRET!,code,grant_type:'authorization_code',redirect_uri:process.env.TWITCH_REDIRECT_URI!})});const token=await tokenRes.json() as any;if(!token.access_token)throw Error('Token exchange failed');const userRes=await fetch('https://api.twitch.tv/helix/users',{headers:{'Client-Id':process.env.TWITCH_CLIENT_ID!,Authorization:`Bearer ${token.access_token}`}});const data=await userRes.json() as any;const u=data.data?.[0];if(!u)throw Error('Could not load Twitch user');const id=crypto.randomUUID();streamerSessions.set(id,{userId:u.id,login:u.login,displayName:u.display_name,avatar:u.profile_image_url});res.cookie('cvg_session',`${id}.${sign(id)}`,{httpOnly:true,sameSite:'lax',secure:true,maxAge:86400000});res.redirect('/');}catch(e){console.error(e);res.redirect('/?twitch_error=login');}});
app.post('/api/logout',(req,res)=>{const raw=req.headers.cookie?.split('; ').find(x=>x.startsWith('cvg_session='))?.split('=')[1];if(raw){const [id]=decodeURIComponent(raw).split('.');streamerSessions.delete(id);}res.clearCookie('cvg_session');res.json({ok:true});});
app.get('/api/state/:channel',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'No active game'});res.json(state(g));});
app.post('/api/game/start',async(req,res)=>{
 const user=session(req);const {channel,mode,settings}=req.body||{};
 if(!['simulation','twitch'].includes(mode))return res.status(400).json({error:'Choose simulation or live Twitch mode.'});
 if(mode==='twitch'&&!user)return res.status(401).json({error:'Connect Twitch to start a live game.'});
 if(mode==='twitch'&&!anthropicApiKey)return res.status(503).json({error:'Set ANTHROPIC_API_KEY before starting a live game.'});
 if(mode==='twitch'&&(!botAccessToken||!botRefreshToken||!botUserId||!eventSubReady))return res.status(503).json({error:'The Twitch chat bot is not ready. Check its access and refresh tokens, required scopes, and EventSub connection.'});
 const name=(mode==='simulation'?String(channel||'simulation').replace(/^#/,'').toLowerCase():user!.login);
 if(!/^[a-z0-9_]{2,25}$/.test(name))return res.status(400).json({error:'Enter a valid Twitch channel name.'});
 if(games.has(name)&&games.get(name)!.phase!=='over')return res.status(409).json({error:'A game is already active for this channel.'});
 const g=newGame(name,mode,settings);if(mode==='twitch')g.broadcasterId=user!.userId;else{g.players.push({id:'you',name:'You',alive:true,joinedAt:Date.now()});for(const [index,npcName] of ['marlow','cleo','vincent'].entries())g.players.push({id:`guest_${npcName}`,name:npcName,alive:true,npc:true,joinedAt:Date.now()+index+1});}games.set(name,g);
 try{if(mode==='twitch')await subscribeToChat(g);}catch(error){games.delete(name);return res.status(503).json({error:`Could not connect Twitch chat: ${(error as Error).message}`});}
 io.emit('game-created',name);res.json(state(g));
});
app.post('/api/game/:channel/command',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'Game not found'});const {name,text}=req.body||{};if(typeof name!=='string'||typeof text!=='string')return res.status(400).json({error:'Name and text required.'});if(g.mode==='twitch')return res.status(403).json({error:'Live commands must come from Twitch chat.'});handle(g,name.slice(0,25),text.slice(0,500),true);res.json({ok:true});});
app.post('/api/game/:channel/begin',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'Game not found'});if(!canManage(req,g))return res.status(403).json({error:'Only this channel’s streamer can control the game.'});if(g.phase!=='lobby'||g.players.length<g.settings.minPlayers)return res.status(400).json({error:`Need at least ${g.settings.minPlayers} human players.`});begin(g);res.json({ok:true});});
app.post('/api/game/:channel/advance',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'Game not found'});if(!canManage(req,g))return res.status(403).json({error:'Only this channel’s streamer can control the game.'});if(g.phase==='discussion')startVoting(g);else if(g.phase==='voting')finishVote(g);else if(g.phase==='reveal')startNextRound(g);emit(g);res.json({ok:true});});
app.post('/api/game/:channel/pause',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'Game not found'});if(!canManage(req,g))return res.status(403).json({error:'Only this channel’s streamer can control the game.'});if(g.deadline){const t=timers.get(g.channel);if(t)clearTimeout(t);timers.delete(g.channel);g.deadline=null;system(g,'The streamer paused the game.');}else if(['discussion','voting','reveal'].includes(g.phase)){g.deadline=Date.now()+(g.phase==='voting'?45000:g.phase==='reveal'?6500:g.settings.discussionSeconds*1000);schedule(g);system(g,'The game has resumed.');}emit(g);res.json({ok:true});});
app.post('/api/game/:channel/kick',(req,res)=>{const g=games.get(req.params.channel.toLowerCase());if(!g)return res.status(404).json({error:'Game not found'});if(!canManage(req,g))return res.status(403).json({error:'Only this channel’s streamer can control the game.'});const target=validPlayer(g,String(req.body?.name||''));if(!target||target.ai)return res.status(400).json({error:'Player not found.'});target.alive=false;g.eliminated.push(target.id);system(g,`${target.name} was removed by the streamer.`);if(g.phase!=='lobby'&&g.players.filter(p=>p.alive&&!p.ai).length<=1){g.phase='over';g.deadline=null;g.recap=makeRecap(g);system(g,'Game over. The AI survived to the final two. The AI wins.');void unsubscribeFromChat(g);}emit(g);res.json({ok:true});});
app.get('/overlay/:channel',(req,res)=>res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../index.html')));
io.on('connection',socket=>{socket.on('watch',channel=>{if(typeof channel!=='string')return;const key=channel.toLowerCase();socket.join(key);const g=games.get(key);if(g)socket.emit('state',state(g));});});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');if(process.env.NODE_ENV==='production')app.use(express.static(path.join(root,'dist')));
if(process.env.NODE_ENV!=='production'){const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
void startEventSub();server.listen(PORT,()=>console.log(`Chat vs. GPT running on http://localhost:${PORT}`));
