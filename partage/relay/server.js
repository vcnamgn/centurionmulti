'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
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
  function status(room){return {protocol:PROTOCOL,online:Boolean(room.master),closed:false,viewers:room.viewers.size,lastFrameAt:room.lastFrameAt||null};}
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
      const data=await fs.readFile(file);
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(head?undefined:data);
    }catch{json(res,404,{error:'not_found'});}
  }
  const server=http.createServer((req,res)=>{handleRequest(req,res).catch(()=>{
    if(!res.headersSent)json(res,400,{error:'request_failed'});else res.destroy();
  });});
  async function handleRequest(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{json(res,400,{error:'invalid_url'});return;}
    if(req.method==='GET'&&pathname==='/healthz'){json(res,200,{ok:true,protocol:PROTOCOL});return;}
    if(req.method==='POST'&&pathname==='/api/sessions'){
      if(!sameOrigin(req)){json(res,403,{error:'origin_refused'});return;}
      let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024){json(res,413,{error:'body_too_large'});return;}}
      expireRooms();
      const ip=req.socket.remoteAddress||'unknown',entry=creationWindows.get(ip)||{start:now(),count:0};
      if(now()-entry.start>=60000){entry.start=now();entry.count=0;}
      if(++entry.count>5){json(res,429,{error:'creation_rate'});return;}creationWindows.set(ip,entry);
      if(rooms.size>=maxRooms){json(res,429,{error:'room_limit'});return;}
      const id=randomBytes(12).toString('base64url'),masterToken=token(),inviteToken=token();
      rooms.set(id,{id,masterHash:digest(masterToken),inviteHash:digest(inviteToken),master:null,authorityId:null,viewers:new Set(),activity:now(),frame:null,lastFrameAt:0,rateStart:now(),rateCount:0});
      json(res,201,{protocol:PROTOCOL,sessionId:id,masterToken,inviteToken});return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'method_refused'});return;}
    const head=req.method==='HEAD';
    if(pathname==='/')return staticFile(res,publicRoot,'index.html',head);
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
