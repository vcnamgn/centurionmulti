'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,randomInt,createHash,timingSafeEqual}=require('node:crypto');
const {Server}=require('socket.io');

const PROTOCOL=3,MAX_FRAME_BYTES=1024*1024,MAX_DOCUMENT_BYTES=6*1024*1024,MAX_COMMAND_BYTES=4*1024*1024;
const COMMAND_KINDS=new Set(['ui','cc-edit','cc-enabled','auto-edit','auto-command','history-page','state-export-start','state-export-page','state-export-end','state-import-start','state-import-part','state-import-finish']);
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
  const actorOf=socket=>socket.data.role==='master'?'master':socket.id;
  const editorName=(room,actor)=>actor==='master'?'Maître':io.sockets.sockets.get(actor)?.data.participantName||'Auxiliaire';
  function editState(room){return {owner:room.editor,revision:room.editorRevision,label:editorName(room,room.editor),pending:room.editPending?{requester:room.editPending.requester,label:editorName(room,room.editPending.requester)}:null};}
  function announceEdit(room){io.to(room.id).emit('edit:state',editState(room));}
  function clearEditRequest(room){clearTimeout(room.editTimer);room.editTimer=null;room.editPending=null;}
  function announce(room){io.to(room.id).emit('session:status',status(room));}
  function expireRooms(){
    for(const room of rooms.values())if(!room.master&&now()-room.activity>idleMs){
      io.to(room.id).emit('session:status',{...status(room),closed:true});
      clearEditRequest(room);rooms.delete(room.id);io.in(room.id).disconnectSockets(true);
    }
    for(const [ip,entry] of creationWindows)if(now()-entry.start>60000)creationWindows.delete(ip);
  }
  async function staticFile(res,root,relative,head,auxiliary=false){
    const file=path.resolve(root,relative);
    if(!file.startsWith(path.resolve(root)+path.sep)){json(res,404,{error:'not_found'});return;}
    try{
      const info=await fs.stat(file);if(!info.isFile())throw Error('not_file');
      let data=await fs.readFile(file);
      if(file===path.join(projectRoot,'simulateur','centurion.html'))data=data.toString().replace('name="centurion-relay" content="off"','name="centurion-relay" content="on"').replaceAll('&amp;shared=0',auxiliary?'&amp;shared=1':'&amp;shared=0');
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(head?undefined:data);
    }catch{json(res,404,{error:'not_found'});}
  }
  const server=http.createServer((req,res)=>{handleRequest(req,res).catch(()=>{
    if(!res.headersSent)json(res,400,{error:'request_failed'});else res.destroy();
  });});
  async function handleRequest(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    let pathname,requestUrl;try{requestUrl=new URL(req.url,'http://localhost');pathname=decodeURIComponent(requestUrl.pathname);}catch{json(res,400,{error:'invalid_url'});return;}
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
        if(form)redirect(res,'/simulateur/centurion.html?shareViewer='+room.id+'#'+params);else json(res,200,{protocol:PROTOCOL,sessionId:room.id,code:room.code,inviteToken:room.inviteToken});
        return;
      }
      if(rooms.size>=maxRooms){json(res,429,{error:'room_limit'});return;}
      const id=randomBytes(12).toString('base64url'),masterToken=token(),inviteToken=token(),code=availableCode();
      if(!code){json(res,429,{error:'room_limit'});return;}
      rooms.set(id,{id,code,masterHash:digest(masterToken),inviteHash:digest(inviteToken),inviteToken,master:null,authorityId:null,viewers:new Set(),activity:now(),frame:null,document:null,editor:"master",editorRevision:1,editPending:null,editTimer:null,participantSerial:0,pendingCommands:0,lastFrameAt:0,rateStart:now(),rateCount:0});
      json(res,201,{protocol:PROTOCOL,sessionId:id,code,masterToken,inviteToken});return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'method_refused'});return;}
    const head=req.method==='HEAD';
    if(pathname==='/'){res.writeHead(302,{Location:'/simulateur/centurion.html','Cache-Control':'no-store'});res.end();return;}
    if(pathname==='/observer')return staticFile(res,publicRoot,'observer.html',head);
    if(pathname.startsWith('/assets/'))return staticFile(res,publicRoot,pathname.slice(8),head);
    if(pathname.startsWith('/simulateur/'))return staticFile(res,path.join(projectRoot,'simulateur'),pathname.slice(12),head,Boolean(requestUrl.searchParams.get('shareViewer')));
    if(pathname.startsWith('/docs/'))return staticFile(res,path.join(projectRoot,'docs'),pathname.slice(6),head);
    if(pathname==='/README.html')return staticFile(res,projectRoot,'README.html',head);
    if(pathname==='/support/README.html')return staticFile(res,path.join(projectRoot,'support'),'README.html',head);
    json(res,404,{error:'not_found'});
  }
  const io=new Server(server,{transports:['websocket'],maxHttpBufferSize:8*1024*1024,serveClient:true,
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
    const room=socket.data.room;socket.data.participantName=socket.data.role==='master'?'Maître':'Auxiliaire '+(++room.participantSerial);
    socket.join(room.id);room.activity=now();announce(room);announceEdit(room);
    socket.on('edit:request',ack=>{
      const reply=value=>{if(typeof ack==='function')ack(value);},actor=actorOf(socket);
      if(!room.master){reply({ok:false,message:'Maître absent.'});return;}
      if(room.editor===actor){reply({ok:true});return;}
      if(room.editPending){reply({ok:false,message:'Une demande d’édition est déjà en attente.'});return;}
      if(socket.data.lastEditRequest&&now()-socket.data.lastEditRequest<10000){reply({ok:false,message:'Attendez quelques secondes avant une nouvelle demande.'});return;}
      socket.data.lastEditRequest=now();const id=randomBytes(12).toString('base64url');room.editPending={id,requester:actor,owner:room.editor};
      const target=room.editor==='master'?room.master:room.editor;
      io.to(target).emit('edit:prompt',{id,label:editorName(room,actor)});announceEdit(room);io.to(room.id).emit('session:event',{text:editorName(room,actor)+' demande le mode éditeur.'});
      room.editTimer=setTimeout(()=>{if(room.editPending?.id!==id)return;clearEditRequest(room);announceEdit(room);io.to(room.id).emit('session:event',{text:'Demande d’édition expirée.'});},60000);room.editTimer.unref();
      reply({ok:true,pending:true});
    });
    socket.on('edit:answer',(answer,ack)=>{
      const reply=value=>{if(typeof ack==='function')ack(value);},pending=room.editPending;
      if(!pending||pending.id!==answer?.id||room.editor!==actorOf(socket)||typeof answer.accept!=='boolean'){reply({ok:false,message:'Demande expirée ou propriétaire différent.'});return;}
      if(answer.accept&&((socket.data.pendingCommands||0)>0)){reply({ok:false,message:'Une modification est encore en cours. Réessayez dans un instant.'});return;}
      const requested=pending.requester;
      if(answer.accept&&requested!=='master'&&!room.viewers.has(requested)){reply({ok:false,message:'Le demandeur a quitté la séance.'});clearEditRequest(room);announceEdit(room);return;}
      if(answer.accept){room.editor=requested;room.editorRevision++;}
      clearEditRequest(room);announceEdit(room);io.to(room.id).emit('session:event',{text:answer.accept?'Édition transférée à '+editorName(room,requested)+'.':'Demande d’édition refusée.'});reply({ok:true});
    });
    function sendDocument(document){
      socket.data.nextDocument=document;if(socket.data.documentInFlight||!socket.connected)return;
      const current=socket.data.nextDocument;socket.data.nextDocument=null;socket.data.documentInFlight=true;
      socket.timeout(5000).emit('session:document',current,()=>{socket.data.documentInFlight=false;if(socket.data.nextDocument)sendDocument(socket.data.nextDocument);});
    }
    socket.data.sendDocument=sendDocument;socket.data.requests=new Map();
    if(socket.data.role==='viewer'){if(room.document)sendDocument(room.document);if(room.frame)socket.emit('state:frame',room.frame);}
    socket.on('session:document',(document,ack)=>{
      const reply=value=>{if(typeof ack==='function')ack(value);};
      if(socket.data.role!=='master'||room.master!==socket.id){reply({ok:false,error:'read_only'});return;}
      if(!document||document.protocol!==PROTOCOL||typeof document.epoch!=='string'||!Number.isSafeInteger(document.revision)||document.revision<0||Buffer.byteLength(JSON.stringify(document))>MAX_DOCUMENT_BYTES){reply({ok:false,error:'invalid_document'});return;}
      if(room.document?.epoch===document.epoch&&document.revision<room.document.revision){reply({ok:false,error:'old_document'});return;}
      room.document=document;
      for(const id of room.viewers)io.sockets.sockets.get(id)?.data.sendDocument(document);
      reply({ok:true});
    });
    socket.on('session:document-request',ack=>{if(socket.data.role==='viewer'&&typeof ack==='function')ack(room.document);});
    socket.on('command:request',(packet,ack)=>{
      const reply=result=>{if(typeof ack==='function')ack(result);};
      if(socket.data.role!=='viewer'){reply({ok:false,error:'invalid_role'});return;}
      if(!packet||typeof packet.id!=='string'||!/^[\w-]{8,80}$/.test(packet.id)||!COMMAND_KINDS.has(packet.action?.kind)||Buffer.byteLength(JSON.stringify(packet))>MAX_COMMAND_BYTES){reply({ok:false,error:'invalid_command'});return;}
      if(['cc-edit','auto-edit','state-import-start','state-import-part','state-import-finish'].includes(packet.action.kind)&&(room.editor!==socket.id||packet.editRevision!==room.editorRevision)){reply({ok:false,error:'edit_required',message:'Cette interface est en visualisation. Demandez le mode édition.'});return;}
      if(!room.master){reply({ok:false,error:'master_offline',message:'Maître indisponible. Aucune commande appliquée.'});return;}
      if(!room.frame||packet.epoch!==room.frame.epoch){reply({ok:false,error:'stale_epoch',message:'Le réacteur a changé. Attendez son actualisation.'});return;}
      const requests=socket.data.requests,hash=createHash('sha256').update(JSON.stringify(packet)).digest('hex'),existing=requests.get(packet.id);
      if(existing){if(existing.hash!==hash){reply({ok:false,error:'duplicate_conflict'});return;}existing.promise.then(reply);return;}
      const at=now();if(!socket.data.commandWindow||at-socket.data.commandWindow.start>=1000)socket.data.commandWindow={start:at,count:0};
      if(++socket.data.commandWindow.count>20||socket.data.pendingCommands>=2||room.pendingCommands>=32){reply({ok:false,error:'command_rate',message:'Trop de commandes simultanées. Réessayez.'});return;}
      socket.data.pendingCommands=(socket.data.pendingCommands||0)+1;room.pendingCommands++;
      const promise=new Promise(resolve=>{
        const master=io.sockets.sockets.get(room.master);
        if(!master){resolve({ok:false,error:'master_offline'});return;}
        master.timeout(20000).emit('command:apply',{id:packet.id,actor:socket.id,epoch:packet.epoch,action:packet.action},(error,result)=>{
          resolve(error?{ok:false,error:'master_timeout',message:'Réponse du maître absente. Vérifiez les valeurs avant de recommencer.'}:result&&typeof result.ok==='boolean'?result:{ok:false,error:'invalid_reply'});
        });
      }).then(result=>{socket.data.pendingCommands--;room.pendingCommands--;if(Buffer.byteLength(JSON.stringify(result))>8192)requests.delete(packet.id);return result;});
      requests.set(packet.id,{hash,promise});if(requests.size>128)requests.delete(requests.keys().next().value);promise.then(reply);
    });
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
      clearEditRequest(room);rooms.delete(room.id);if(typeof ack==='function')ack({ok:true});io.in(room.id).disconnectSockets(true);
    });
    socket.on('disconnect',()=>{
      if(room.master===socket.id)room.master=null;room.viewers.delete(socket.id);
      if(room.editPending&&(room.editPending.requester===actorOf(socket)||room.editPending.owner===actorOf(socket)))clearEditRequest(room);
      if(room.editor===socket.id){room.editor='master';room.editorRevision++;io.to(room.id).emit('session:event',{text:'Éditeur déconnecté · édition rendue au maître.'});}
      if(rooms.has(room.id))announceEdit(room);
      if(rooms.has(room.id)){room.activity=now();announce(room);}
    });
  });
  const timer=setInterval(expireRooms,60000);timer.unref();
  return {server,listen:(port=0,host='127.0.0.1')=>new Promise(resolve=>server.listen(port,host,()=>resolve(server.address()))),
    close:()=>new Promise(resolve=>{clearInterval(timer);for(const room of rooms.values())clearEditRequest(room);io.close(()=>resolve());}),expireRooms};
}
if(require.main===module){
  const relay=createRelay();relay.listen(Number(process.env.PORT)||3000,process.env.HOST||'127.0.0.1').then(address=>console.log(`Centurion Relay : port ${address.port}`));
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>relay.close().then(()=>process.exit(0)));
}
module.exports={createRelay,PROTOCOL};
