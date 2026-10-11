const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../centurion-auto'),R=require('../centurion-auto-routing');
const create=(types,delay=0)=>{const g=A.emptyGraph();g.stepDelayS=delay;g.nodes=types.map((t,i)=>A.node(t,'n'+i,i*300,80));return g;};
const edge=(g,a,b,port='next')=>g.links.push({id:'e'+g.links.length,from:'n'+a,to:'n'+b,port});
const pair=(g,f,j)=>{g.nodes[f].params.join='n'+j;g.nodes[j].params.fork='n'+f;};
const run=(r,g,count,read=()=>155,execute=()=>{})=>{for(let i=0;i<count;i++)A.tick(r,g,.1,read,execute);};

test('durée minimale : défaut 2 s simulées, variantes 0/1/2/5 et surcharge par boîte',()=>{
  assert.equal(A.emptyGraph().stepDelayS,2);
  for(const delay of A.STEP_DELAYS){
    const g=create(['start','action','end'],delay);edge(g,0,1);edge(g,1,2);
    const r=A.start(g,'n0'),calls=[];run(r,g,180,()=>0,(id,v,check)=>{if(!check)calls.push(id);});
    assert.equal(r.status,'complete');assert.deepEqual(calls,['turbine.target']);
    for(const id of ['n0','n1','n2']){
      const entries=r.history.filter(h=>h.node===id),entry=entries.find(h=>h.event==='entrée');
      const exit=entries.find(h=>['next','fin'].includes(h.event));assert.ok(exit.time-entry.time>=delay-1e-8);
    }
  }
  const g=create(['start','wait','end'],2);g.nodes[0].params.stepDelayS=0;g.nodes[1].params.duration=5;edge(g,0,1);edge(g,1,2);
  const r=A.start(g,'n0');run(r,g,51);assert.equal(r.current,'n1');run(r,g,1);assert.equal(r.current,'n2');
  g.stepDelayS=3;assert.throws(()=>A.validate(g),/Durée minimale/);
});

test('curseurs indépendants : deux branches, test en attente et clôture sans suite prématurée',()=>{
  const g=create(['start','parallel','action','test','join','action','end']);pair(g,1,4);
  g.nodes[2].params={command:'rcv.boron',value:1500};g.nodes[3].params.variable='pressure';g.nodes[3].params.value=31;
  g.nodes[5].params={command:'turbine.target',value:20};
  edge(g,0,1);edge(g,1,2,'branch:0');edge(g,1,3,'branch:1');edge(g,2,4);edge(g,3,4,'yes');edge(g,4,5);edge(g,5,6);
  const r=A.start(g,'n0'),calls=[];const execute=(id,v,check)=>{if(!check)calls.push(id);};
  run(r,g,30,()=>155,execute);assert.deepEqual(calls,['rcv.boron']);assert.equal(r.tokens.length,2);
  assert.deepEqual(new Set(r.activeNodes),new Set(['n3','n4']));
  const paused=structuredClone(r);r.status='paused';run(r,g,200,()=>0,execute);assert.equal(r.totalElapsed,paused.totalElapsed);
  r.status='running';run(r,g,10,()=>30,execute);assert.equal(r.status,'complete');assert.deepEqual(calls,['rcv.boron','turbine.target']);
  assert.equal(r.history.filter(h=>h.event==='toutes les branches terminées').length,1);
});

test('parallèle imbriqué : fermeture intérieure puis extérieure, une seule continuation',()=>{
  const g=create(['start','parallel','parallel','wait','info','join','info','join','action','end']);
  pair(g,1,7);pair(g,2,5);g.nodes[3].params.duration=1;
  edge(g,0,1);edge(g,1,2,'branch:0');edge(g,1,6,'branch:1');edge(g,2,3,'branch:0');edge(g,2,4,'branch:1');
  edge(g,3,5);edge(g,4,5);edge(g,5,7);edge(g,6,7);edge(g,7,8);edge(g,8,9);
  const r=A.start(g,'n0'),calls=[];run(r,g,40,()=>0,(id,v,check)=>{if(!check)calls.push(id);});
  assert.equal(r.status,'complete');assert.deepEqual(calls,['turbine.target']);assert.equal(r.groups.length,0);
  assert.equal(r.history.filter(h=>h.event==='toutes les branches terminées').length,2);
});

test('validation : clôture obligatoire, toutes les sorties et absence de fins dans les branches',()=>{
  const g=create(['start','parallel','info','join','end']);edge(g,0,1);edge(g,1,2,'branch:0');edge(g,2,3);edge(g,3,4);
  assert.throws(()=>A.start(g,'n0'),/Clôture obligatoire/);pair(g,1,3);
  assert.throws(()=>A.start(g,'n0'),/Reliez toutes les branches/);edge(g,1,4,'branch:1');
  assert.throws(()=>A.start(g,'n0'),/sans fin intermédiaire/);g.links.at(-1).to='n2';
  assert.throws(()=>A.start(g,'n0'),/distinctes/);
});

test('JSON : deux curseurs et barrière conservés, corruption rejetée et ancien lot entré sans rejeu',()=>{
  const g=create(['start','parallel','action','wait','join','end']);pair(g,1,4);g.nodes[3].params.duration=10;
  edge(g,0,1);edge(g,1,2,'branch:0');edge(g,1,3,'branch:1');edge(g,2,4);edge(g,3,4);edge(g,4,5);
  const r=A.start(g,'n0');run(r,g,8);const restored=A.validateSaved({graph:g,runtime:r});assert.deepEqual(restored.runtime,r);
  restored.runtime.groups[0].arrived=[99];assert.throws(()=>A.validateSaved(restored),/Synchronisation/);
  const old=create(['start','parallel','end']);old.version=1;delete old.stepDelayS;
  old.nodes[1].params={actions:[{type:'action',command:'turbine.target',value:80},{type:'wait',duration:10,unit:'seconds'}]};edge(old,0,1);edge(old,1,2);
  const saved={graph:old,runtime:{status:'running',sequence:'n0',current:'n1',entered:true,elapsed:5,totalElapsed:6,remaining:5,message:'lot',error:null,lastValue:null,lastPort:null,history:[]}};
  const converted=A.validateSaved(saved),calls=[];run(converted.runtime,converted.graph,140,()=>0,(id,v,check)=>{if(!check)calls.push(id);});
  assert.equal(converted.runtime.status,'complete');assert.deepEqual(calls,[]);
  old.nodes[1].params.actions=Array.from({length:24},(_,i)=>({type:'info',message:'Information '+i}));
  const large=A.validate(old),many=A.start(large,'n0');run(many,large,350);
  assert.equal(many.status,'complete');assert.equal(many.history.filter(h=>h.event.startsWith('Information ')).length,24);
});

test('connecteurs : angle droit, contournement d’une boîte, boucle et obstruction signalée',()=>{
  const g=create(['action','action','info']);g.nodes[0].x=0;g.nodes[0].y=0;g.nodes[1].x=0;g.nodes[1].y=500;g.nodes[2].x=0;g.nodes[2].y=220;
  const link={from:'n0',to:'n1',port:'next'},route=R.route(g,link);assert.equal(route.blocked,false);
  const obstacle=g.nodes[2],d=R.dimensions(obstacle);
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i];assert.ok(a.x===b.x||a.y===b.y);
    if(a.y===b.y)assert.ok(!(a.y>obstacle.y&&a.y<obstacle.y+d.h&&Math.max(a.x,b.x)>obstacle.x&&Math.min(a.x,b.x)<obstacle.x+d.w));
    else assert.ok(!(a.x>obstacle.x&&a.x<obstacle.x+d.w&&Math.max(a.y,b.y)>obstacle.y&&Math.min(a.y,b.y)<obstacle.y+d.h));
  }
  assert.equal(R.route(g,{from:'n0',to:'n0',port:'next'}).blocked,false);assert.ok(!/[CQ]/.test(R.path(route.points)));
  g.nodes[2].y=90;assert.equal(R.route(g,link).blocked,true);
});
