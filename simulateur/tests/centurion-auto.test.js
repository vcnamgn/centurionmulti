const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../centurion-auto'),E=require('../centurion-engine'),H=require('../centurion-history'),State=require('../centurion-state');
const {editorSurface}=require('./helpers/editor-surface'),{svgSurface}=require('./helpers/svg-surface');
const make=(types)=>{const g=A.emptyGraph();g.nodes=types.map((t,i)=>A.node(t,'n'+i,50+i*240,80));return g;};
const link=(g,from,to,port='next')=>g.links.push({id:'e'+g.links.length,from:'n'+from,to:'n'+to,port});
const variables=new Set(A.measurementCatalog(E,H,E.make()).map(d=>d.id));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('conduite : graphe vide, départs nommés, types et fichiers validés sans code exécutable',()=>{
  assert.deepEqual(A.validate(JSON.stringify(A.emptyGraph())),A.emptyGraph());
  const g=make(A.TYPES);assert.equal(A.validate(g,variables).nodes.length,8);
  assert.deepEqual(A.sequences(g),[{id:'n0',name:'Nouvelle séquence'}]);
  const bad=structuredClone(g);bad.nodes.push(A.node('start','another'));
  assert.throws(()=>A.validate(bad),/noms distincts/);
  bad.nodes.pop();bad.nodes[1].params.variable='NOT_A_SENSOR';assert.throws(()=>A.validate(bad,variables),/Mesure/);
  bad.nodes[1].params.variable='pressure';bad.nodes[3].params.command='eval';assert.throws(()=>A.validate(bad),/inconnue/);
  bad.nodes[3].params.command='turbine.target';bad.nodes[3].params.value=200;assert.throws(()=>A.validate(bad),/Valeur/);
  assert.throws(()=>A.validate('x'.repeat(2000001)),/volumineuse/);
});
test('comparaisons : opérateurs et tolérance dans l’unité physique',()=>{
  assert.equal(A.compare(30.05,'=',30,.1),true);assert.equal(A.compare(30.2,'=',30,.1),false);
  assert.equal(A.compare(30.05,'!=',30,.1),false);assert.equal(A.compare(30.2,'!=',30,.1),true);
  assert.equal(A.compare(30.05,'>',30,.1),false);assert.equal(A.compare(30.2,'>',30,.1),true);
  assert.equal(A.compare(29.95,'>=',30,.1),true);assert.equal(A.compare(29.8,'>=',30,.1),false);
  assert.equal(A.compare(29.95,'<',30,.1),false);assert.equal(A.compare(29.8,'<',30,.1),true);
  assert.equal(A.compare(30.05,'<=',30,.1),true);assert.equal(A.compare(30.2,'<=',30,.1),false);
  assert.throws(()=>A.compare(null,'=',0),/indisponible/);
});
test('règle à plages : frontières non ambiguës et tolérance aux bornes externes',()=>{
  const p=A.node('ranges','r').params;
  assert.equal(A.classify(14.99,p.ranges),'range:0');assert.equal(A.classify(15,p.ranges),'range:1');
  assert.equal(A.classify(70,p.ranges),'range:2');assert.equal(A.classify(100,p.ranges),'range:2');
  assert.equal(A.classify(-.05,p.ranges,.1),'range:0');assert.equal(A.classify(-.2,p.ranges,.1),'no-left');
  assert.equal(A.classify(101,p.ranges,.1),'no-right');
  const g=make(['ranges']);g.nodes[0].params.ranges[1].min=10;assert.throws(()=>A.validate(g),/superposées/);
});
test('connecteurs : entrée haute, une sortie négative au choix et boucles sans verrouiller le navigateur',()=>{
  const g=make(['start','test','end']);link(g,0,1);link(g,1,2,'no-right');
  const r=A.start(g,'n0',variables);A.tick(r,g,.1,()=>155,()=>{});A.tick(r,g,.1,()=>155,()=>{});
  assert.equal(r.current,'n2');assert.equal(r.lastPort,'no-right');
  link(g,1,2,'no-left');assert.throws(()=>A.validate(g),/une seule sortie négative/);
  g.links.pop();g.links[1].to='n1';
  const loop=A.start(g,'n0');for(let i=0;i<20;i++)A.tick(loop,g,.1,()=>155,()=>{});
  assert.equal(loop.status,'running');assert.equal(loop.current,'n1');close(loop.totalElapsed,2);
  g.links.push({id:'bad',from:'n2',to:'n0',port:'next'});assert.throws(()=>A.validate(g),/Liaison invalide/);
});
test('exécution : test sans branche négative attend, commande une seule fois et attente simulée',()=>{
  const g=make(['start','test','action','wait','info','end']);link(g,0,1);link(g,1,2,'yes');link(g,2,3);link(g,3,4);link(g,4,5);
  g.nodes[2].params={command:'setpoint.gcta',value:65};g.nodes[3].params={duration:1,unit:'seconds'};
  g.nodes[4].params.message='Refroidissement engagé';const r=A.start(g,'n0');let pressure=155,commands=[];
  const step=()=>A.tick(r,g,.1,()=>pressure,(id,value,check)=>{if(!check)commands.push([id,value]);});
  for(let i=0;i<50;i++)step();assert.equal(r.current,'n1');assert.deepEqual(commands,[]);
  pressure=30;for(let i=0;i<20;i++)step();assert.equal(r.status,'complete');assert.deepEqual(commands,[['setpoint.gcta',65]]);
  assert.ok(r.history.some(h=>h.event==='Refroidissement engagé'));
  assert.ok(r.history.find(h=>h.node==='n3'&&h.event==='next').time-r.history.find(h=>h.node==='n3'&&h.event==='entrée').time>=.9-1e-8);
});
test('parallèle : commandes lancées ensemble, attente maximale, rejet avant toute application',()=>{
  const g=make(['start','parallel','end']);link(g,0,1);link(g,1,2);
  g.nodes[1].params.actions=[{type:'action',command:'turbine.target',value:80},{type:'action',command:'rcv.boron',value:1500},
    {type:'wait',duration:.02,unit:'minutes'},{type:'wait',duration:.0001,unit:'hours'}];
  const r=A.start(g,'n0'),calls=[];
  for(let i=0;i<20;i++)A.tick(r,g,.1,()=>0,(id,value,check)=>{if(!check)calls.push(id);});
  assert.equal(r.status,'complete');assert.deepEqual(calls,['turbine.target','rcv.boron']);
  const broken=A.start(g,'n0'),applied=[];
  for(let i=0;i<3;i++)A.tick(broken,g,.1,()=>0,(id,v,check)=>{if(check&&id==='rcv.boron')throw Error('Essai bloqué');if(!check)applied.push(id);});
  assert.equal(broken.status,'error');assert.equal(broken.current,'n1');assert.deepEqual(applied,[]);
});
test('pause, arrêt et reprise : aucune action répétée, même avec des trames regroupées ×200',()=>{
  const g=make(['start','parallel','end']);link(g,0,1);link(g,1,2);const calls=[];
  const r=A.start(g,'n0');for(let i=0;i<5;i++)A.tick(r,g,.1,()=>0,(id,v,check)=>{if(!check)calls.push(id);});
  const elapsed=r.elapsed;r.status='paused';for(let i=0;i<200;i++)A.tick(r,g,.1,()=>0,()=>{throw Error('ne doit pas exécuter');});
  assert.equal(r.elapsed,elapsed);r.status='running';
  for(let i=0;i<200;i++)A.tick(r,g,.1,()=>0,(id,v,check)=>{if(!check)calls.push(id);});
  assert.equal(r.status,'complete');assert.deepEqual(calls,['turbine.target']);
});
test('commandes réelles : priorités CC, surcharge R, RRA et brèche conservée lors d’un arrêt RIS',()=>{
  const model=E.make(),ctx={E,model,regulationActive:true,setRegulationActive(){},setProtectionActive(){},
    setRManualOverride:v=>E.setRManualOverride(model,v)};
  assert.throws(()=>A.executeCommand(ctx,'heater',500),/CC-RÉGUL/);
  assert.throws(()=>A.executeCommand(ctx,'rods.R',220),/manuel/);
  A.executeCommand(ctx,'rods.manual',1);A.executeCommand(ctx,'rods.R',220);assert.equal(model.controls.rManualPas,220);
  A.executeCommand(ctx,'setpoint.level',60);assert.equal(model.controls.pzrLevelSetpointManual,true);
  A.executeCommand(ctx,'rate.gcta',.25);A.executeCommand(ctx,'setpoint.gcta',65);
  assert.equal(model.controls.setpointRamps.gcta.rate,.25);assert.equal(model.controls.setpointRamps.gcta.target,65);
  assert.throws(()=>A.executeCommand(ctx,'rra.connect',1),/Connexion RRA impossible/);
  E.initiate(model,'break',{areaCm2:300});A.executeCommand(ctx,'ris.mode','off');assert.equal(model.controls.breakAreaCm2,300);
  A.executeCommand(ctx,'relief.1',1);assert.equal(model.controls.manualReliefStages[0],true);
  E.initiate(model,'trip');
  assert.throws(()=>A.executeCommand(ctx,'rods.all',260),/AAR/);
});
test('catalogue : toutes les mesures du graphique et du tableau, états standard et conditions RRA',()=>{
  const m=E.make(),defs=A.measurementCatalog(E,H,m),point=E.historyPoint(m);
  assert.equal(defs.length,H.catalog(E,m).length+5);
  const value=id=>defs.find(d=>d.id===id).value(point,m);
  close(value('pressure'),155);close(value('tavg'),306.5);assert.equal(value('operating.RP'),1);assert.equal(value('rra.allowed'),0);
  assert.ok(A.actionCatalog().some(d=>d.id==='rate.gcta'&&d.options.some(([value])=>value===.25)));
  assert.ok(E.SETPOINT_RATES.includes(.25));
});
test('JSON d’état : atelier et attente repris exactement, fichiers antérieurs sans atelier acceptés',()=>{
  const g=make(['start','wait','end']);link(g,0,1);link(g,1,2);const r=A.start(g,'n0');
  for(let i=0;i<8;i++)A.tick(r,g,.1,()=>0,()=>{});
  const m=E.make(),editors={regul:editorSurface().bridge.receive({type:'centurion-editor-save'}).saved,
    protect:editorSurface('protect').bridge.receive({type:'centurion-editor-save'}).saved};
  const ui={speed:200,diagram:'pt',selectedGv:1,activeView:'conduiteAuto',historyFollowing:true,historyEndS:null,
    historyWindow:'300',traceSet:'powers',coreTrailWindow:'300',ptTrailWindow:'300',alarmLimits:{},autoConduite:{graph:g,runtime:r}};
  const saved=State.write(E,m,editors,ui,null),loaded=State.read(E,JSON.stringify(saved));
  assert.deepEqual(loaded.ui.autoConduite,{graph:g,runtime:r});
  loaded.ui.autoConduite.runtime.current='absent';assert.throws(()=>State.read(E,loaded),/Séquence.*absente/);
  delete saved.ui.autoConduite;assert.doesNotThrow(()=>State.read(E,saved));
});
test('application : onglets ordonnés, source vérifiée, physique active, pause/reset de séquence',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../centurion.html'),'utf8'),app=fs.readFileSync(path.resolve(__dirname,'../centurion-app.js'),'utf8');
  const startup=fs.readFileSync(path.resolve(__dirname,'centurion-startup.test.js'),'utf8');
  const context=vm.createContext({E,H,State,app,html,vm,assert,svgSurface,Blob});
  vm.runInContext(startup.slice(startup.indexOf('function application('),startup.indexOf('\ntest('))+'globalThis.application=application;',context);
  const m=E.make();let initial=true;
  const page=context.application(app,null,{...E,make:()=>{if(initial){initial=false;return m;}return E.make();}},{},{autoModule:A});
  const g=make(['start','action','wait','end']);g.nodes[1].params={command:'turbine.target',value:80};link(g,0,1);link(g,1,2);link(g,2,3);
  const source=page.get('autoEditor').contentWindow;
  page.receive({type:'centurion-auto-ready',graph:g},source);
  page.receive({type:'centurion-auto-command',action:'start',sequence:'n0'},{});
  assert.equal(m.controls.manualTurbineTargetPct,null);
  page.get('simSpeed').value='1';page.get('simSpeed').fire('change');
  page.receive({type:'centurion-auto-command',action:'start',sequence:'n0'},source);
  for(let i=0;i<5;i++)page.frame(100);
  assert.equal(m.controls.manualTurbineTargetPct,80);assert.ok(m.state.demandPct<100);
  page.receive({type:'centurion-auto-command',action:'pause'},source);
  const elapsed=page.messages.findLast(m=>m.type==='centurion-auto-state').runtime.elapsed;
  for(let i=0;i<10;i++)page.frame(100);
  assert.equal(page.messages.findLast(m=>m.type==='centurion-auto-state').runtime.elapsed,elapsed);
  page.receive({type:'centurion-auto-command',action:'resume'},source);page.frame(100);
  assert.equal(page.messages.findLast(m=>m.type==='centurion-auto-state').runtime.status,'running');
  page.click('resetButton');assert.equal(page.messages.findLast(m=>m.type==='centurion-auto-state').runtime.status,'idle');
  const tabs=[...html.matchAll(/class="tab(?: active)?" data-view="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(tabs,['synoptiques','graphiques','initiateurs','transitoires','regulation','protection','conduiteAuto','modele']);
});
