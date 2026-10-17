'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,randomInt,createHash,timingSafeEqual}=require('node:crypto');
const {Server}=require('socket.io');

const PROTOCOL=1,MAX_FRAME_BYTES=64*1024;
const token=()=>randomBytes(32).toString('base64url');
const digest=value=>createHash('sha256').update(value).digest();
const matches=(value,expected)=>typeof value==='string'&&value.length<=100&&timingSafeEqual(digest(value),expected);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.md':'text/plain; charset=utf-8'};

function createRelay({maxRooms=20,maxViewers=20,idleMs=30*60*1000,now=Date.now,projectRoot=path.resolve(__dirname,'../..')}={}){
  const rooms=new Map(),creationWindows=new Map();
  const publicRoot=path.join(__dirname,'public');
  function sameOrigin(req){
    if(!req.headers.origin)return true;
    const allowed=[process.env.CLOUDRON_APP_ORIGIN,`http://${req.headers.host}`,`https://${req.headers.host}`].filter(Boolean);
    return allowed.includes(req.headers.origin);
  }
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
  function redirect(res,location){res.writeHead(303,{Location:location,'Cache-Control':'no-store'});res.end();}
  function status(room){return {protocol:PROTOCOL,code:room.code,online:Boolean(room.master),closed:false,viewers:room.viewers.size,lastFrameAt:room.lastFrameAt||null};}
  function rateAllowed(req,kind,limit){
    // Cloudron est le proxy de confiance ; la dernière adresse transmise est celle de son client.
    const forwarded=process.env.CLOUDRON_APP_ORIGIN&&req.headers['x-forwarded-for'];
    const ip=forwarded?String(forwarded).split(',').at(-1).trim():req.socket.remoteAddress||'unknown';
    const key=kind+':'+ip,entry=creationWindows.get(key)||{start:now(),count:0};
    if(now()-entry.start>=60000){entry.start=now();entry.count=0;}
    entry.count++;creationWindows.set(key,entry);return entry.count<=limit;
  }
  function availableCode(){
    const used=new Set([...rooms.values()].map(room=>room.code));
    const first=randomInt(1000,10000);
    for(let n=0;n<9000;n++){const code=String(1000+(first-1000+n)%9000);if(!used.has(code))return code;}
    return null;
  }
  function announce(room){io.to(room.id).emit('session:status',status(room));}
  function expireRooms(){
    for(const room of rooms.values())if(!room.master&&now()-room.activity>idleMs){
      io.to(room.id).emit('session:status',{...status(room),closed:true});
      rooms.delete(room.id);io.in(room.id).disconnectSockets(true);
    }
    for(const [ip,entry] of creationWindows)if(now()-entry.start>60000)creationWindows.delete(ip);
  }
  async function staticFile(res,root,relative,head){
    const file=path.resolve(root,relative);
    if(!file.startsWith(path.resolve(root)+path.sep)){json(res,404,{error:'not_found'});return;}
    try{
      const info=await fs.stat(file);if(!info.isFile())throw Error('not_file');
      let data=await fs.readFile(file);
      if(file===path.join(projectRoot,'simulateur','centurion.html'))data=data.toString().replace('name="centurion-relay" content="off"','name="centurion-relay" content="on"');
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(head?undefined:data);
    }catch{json(res,404,{error:'not_found'});}
  }
  const server=http.createServer((req,res)=>{handleRequest(req,res).catch(()=>{
    if(!res.headersSent)json(res,400,{error:'request_failed'});else res.destroy();
  });});
  async function handleRequest(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{json(res,400,{error:'invalid_url'});return;}
    if(req.method==='GET'&&pathname==='/healthz'){json(res,200,{ok:true,protocol:PROTOCOL});return;}
    if(req.method==='POST'&&['/api/sessions','/api/sessions/join'].includes(pathname)){
      if(!sameOrigin(req)){json(res,403,{error:'origin_refused'});return;}
      expireRooms();
      const joining=pathname.endsWith('/join'),form=(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded');
      const refused=(http,error)=>form&&joining?redirect(res,'/observer?joinError='+error):json(res,http,{error});
      if(!rateAllowed(req,joining?'join':'create',joining?10:5)){refused(429,joining?'join_rate':'creation_rate');return;}
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024){refused(413,'body_too_large');return;}chunks.push(chunk);}
      if(joining){
        let body;try{const raw=Buffer.concat(chunks).toString();body=form?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw);}catch{refused(400,'invalid_code');return;}
        if(typeof body?.code!=='string'||!/^\d{4}$/.test(body.code)){refused(400,'invalid_code');return;}
        const room=[...rooms.values()].find(r=>r.code===body.code&&r.master);
        if(!room){refused(404,'session_unavailable');return;}
        // Le numéro ouvre seulement une invitation en lecture seule, jamais la capacité maître.
        const params=new URLSearchParams({session:room.id,inviteToken:room.inviteToken,code:room.code});
        if(form)redirect(res,'/observer#'+params);else json(res,200,{protocol:PROTOCOL,sessionId:room.id,code:room.code,inviteToken:room.inviteToken});
        return;
      }
      if(rooms.size>=maxRooms){json(res,429,{error:'room_limit'});return;}
      const id=randomBytes(12).toString('base64url'),masterToken=token(),inviteToken=token(),code=availableCode();
      if(!code){json(res,429,{error:'room_limit'});return;}
      rooms.set(id,{id,code,masterHash:digest(masterToken),inviteHash:digest(inviteToken),inviteToken,master:null,authorityId:null,viewers:new Set(),activity:now(),frame:null,lastFrameAt:0,rateStart:now(),rateCount:0});
      json(res,201,{protocol:PROTOCOL,sessionId:id,code,masterToken,inviteToken});return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'method_refused'});return;}
    const head=req.method==='HEAD';
    if(pathname==='/'){res.writeHead(302,{Location:'/simulateur/centurion.html','Cache-Control':'no-store'});res.end();return;}
    if(pathname==='/observer')return staticFile(res,publicRoot,'observer.html',head);
    if(pathname.startsWith('/assets/'))return staticFile(res,publicRoot,pathname.slice(8),head);
    if(pathname.startsWith('/simulateur/'))return staticFile(res,path.join(projectRoot,'simulateur'),pathname.slice(12),head);
    if(pathname.startsWith('/docs/'))return staticFile(res,path.join(projectRoot,'docs'),pathname.slice(6),head);
    if(pathname==='/README.html')return staticFile(res,projectRoot,'README.html',head);
    if(pathname==='/support/README.html')return staticFile(res,path.join(projectRoot,'support'),'README.html',head);
    json(res,404,{error:'not_found'});
  }
  const io=new Server(server,{transports:['websocket'],maxHttpBufferSize:MAX_FRAME_BYTES+2048,serveClient:true,
    allowRequest:(req,done)=>done(null,sameOrigin(req)),perMessageDeflate:false});
  io.use((socket,next)=>{
    const {sessionId,role,token:proof,protocol,authorityId}=socket.handshake.auth||{};
    const room=rooms.get(sessionId);
    if(protocol!==PROTOCOL)return next(Error('incompatible_protocol'));
    if(!room||!['master','viewer'].includes(role)||!matches(proof,role==='master'?room.masterHash:room.inviteHash))return next(Error('access_refused'));
    if(role==='master'&&room.master)return next(Error('master_already_connected'));
    if(role==='master'&&(typeof authorityId!=='string'||!/^[\w-]{8,80}$/.test(authorityId)))return next(Error('invalid_authority'));
    if(role==='master'&&room.authorityId&&room.authorityId!==authorityId)return next(Error('authority_lost'));
    if(role==='viewer'&&room.viewers.size>=maxViewers)return next(Error('viewer_limit'));
    // Réserver ici évite deux maîtres validés avant leur événement connection.
    if(role==='master'){room.master=socket.id;room.authorityId=authorityId;}else room.viewers.add(socket.id);
    socket.data.room=room;socket.data.role=role;next();
  });
  io.on('connection',socket=>{
    const room=socket.data.room;socket.join(room.id);room.activity=now();announce(room);
    if(socket.data.role==='viewer'&&room.frame)socket.emit('state:frame',room.frame);
    socket.on('state:frame',(frame,ack)=>{
      const reply=code=>{if(typeof ack==='function')ack({ok:!code,...(code?{error:code}:{})});};
      if(socket.data.role!=='master'||room.master!==socket.id){reply('read_only');return;}
      if(!frame||frame.protocol!==PROTOCOL||typeof frame.epoch!=='string'||!/^[\w-]{8,80}$/.test(frame.epoch)
        ||!Number.isSafeInteger(frame.seq)||frame.seq<1||!Number.isFinite(frame.time)||frame.time<0
        ||!frame.instruments||!Number.isFinite(frame.instruments.time)||Math.abs(frame.instruments.time-frame.time)>1e-6
        ||!Array.isArray(frame.instruments.gvAll)||frame.instruments.gvAll.length!==4
        ||!Array.isArray(frame.instruments.loops)||frame.instruments.loops.length!==4
        ||typeof frame.simulation?.running!=='boolean'){reply('invalid_frame');return;}
      if(Buffer.byteLength(JSON.stringify(frame))>MAX_FRAME_BYTES){reply('frame_too_large');return;}
      if(room.frame?.epoch===frame.epoch&&frame.seq<=room.frame.seq){reply('old_frame');return;}
      if(now()-room.rateStart>=1000){room.rateStart=now();room.rateCount=0;}
      if(++room.rateCount>8){reply('publication_rate');return;}
      room.frame=frame;room.lastFrameAt=now();room.activity=now();
      socket.to(room.id).volatile.emit('state:frame',frame);reply();
    });
    socket.on('session:end',ack=>{
      if(socket.data.role!=='master'||room.master!==socket.id){if(typeof ack==='function')ack({ok:false,error:'read_only'});return;}
      io.to(room.id).emit('session:status',{...status(room),closed:true,online:false});
      rooms.delete(room.id);if(typeof ack==='function')ack({ok:true});io.in(room.id).disconnectSockets(true);
    });
    socket.on('disconnect',()=>{
      if(room.master===socket.id)room.master=null;room.viewers.delete(socket.id);
      if(rooms.has(room.id)){room.activity=now();announce(room);}
    });
  });
  const timer=setInterval(expireRooms,60000);timer.unref();
  return {server,listen:(port=0,host='127.0.0.1')=>new Promise(resolve=>server.listen(port,host,()=>resolve(server.address()))),
    close:()=>new Promise(resolve=>{clearInterval(timer);io.close(()=>resolve());}),expireRooms};
}
if(require.main===module){
  const relay=createRelay();relay.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1').then(address=>console.log(`Centurion Relay : port ${address.port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>relay.close().then(()=>process.exit(0)));
}
module.exports={createRelay,PROTOCOL};
