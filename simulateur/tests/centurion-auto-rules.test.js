const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../centurion-auto'),R=require('../centurion-auto-routing'),E=require('../centurion-engine'),H=require('../centurion-history');
const {editorSurface}=require('./helpers/editor-surface');
const catalog=A.measurementCatalog(E,H,E.make());
const graph=()=>{const g=A.emptyGraph();g.nodes=[A.node('ranges','rule')];return g;};

test('règles : échelles du catalogue, unités de secours et trois chiffres significatifs',()=>{
  for(const id of ['pressure','pzrLevel','tavg','rod.R','g3','boron','dpax','dnbr']){
    const m=catalog.find(m=>m.id===id);assert.deepEqual(A.ruleScale(m),{min:m.range[0],max:m.range[1]});
  }
  assert.deepEqual(A.ruleScale(catalog.find(m=>m.id==='operating.RP')),{min:0,max:1});
  for(const [v,result] of [[15.123456,15.1],[155.765,156],[.00345678,.00346],[-98765.432,-98800],[0,0]])assert.equal(A.roundRuleValue(v),result);
  const p=A.node('ranges','r').params;A.setRuleScale(p,{min:280,max:350},true);
  assert.deepEqual(p.separators,[291,329]);
  assert.equal(A.ruleSegments(p)[0].max,A.ruleSegments(p)[1].min);
});

test('édition : un seul repère partagé, rejet des croisements et conservation des liens lors des fusions',()=>{
  const g=graph(),n=g.nodes[0];A.setRuleSeparator(n.params,0,19.875);
  const ranges=A.ruleSegments(n.params);assert.equal(ranges[0].max,19.875);assert.equal(ranges[1].min,19.875);
  assert.throws(()=>A.setRuleSeparator(n.params,0,80),/strictement/);assert.equal(n.params.separators[0],19.875);
  assert.throws(()=>A.setRuleScale(n.params,{min:25,max:100}),/contenir/);
  g.nodes.push(A.node('end','end'));g.links=n.params.labels.map((_,i)=>({id:'l'+i,from:'rule',to:'end',port:'range:'+i}));
  const index=A.splitRule(g,n);assert.equal(n.params.labels.length,4);assert.equal(g.links.length,3);
  assert.ok(!g.links.some(l=>l.port==='range:'+(index+1)));
  A.removeRuleSeparator(g,n,index);assert.equal(n.params.labels.length,3);assert.deepEqual(g.links.map(l=>l.port),['range:0','range:1','range:2']);
  A.removeRuleSeparator(g,n,0);assert.deepEqual(g.links.map(l=>l.port),['range:0','range:1']);assert.doesNotThrow(()=>A.validate(g));
});

test('compatibilité : règles anciennes contiguës, intervalles vides et anciens liens latéraux transférés en bas',()=>{
  const g=graph();g.version=1;g.nodes[0].params={variable:'pressure',tolerance:0,ranges:[{label:'Bas',min:0,max:15},{label:'Haut',min:20,max:100}]};
  g.nodes.push(A.node('end','end'));g.links=[{id:'low',from:'rule',to:'end',port:'no-left'},{id:'high',from:'rule',to:'end',port:'no-right'},
    {id:'normal',from:'rule',to:'end',port:'range:1'}];
  const valid=A.validate(g);assert.equal(valid.version,3);assert.deepEqual(valid.nodes[0].params.separators,[0,15,20,100]);
  assert.deepEqual(valid.links.map(l=>l.port),['range:0','range:4','range:3']);
  assert.equal(A.classify(17,valid.nodes[0].params),'range:2');assert.ok(!valid.links.some(l=>l.port==='range:2'));
  assert.ok(!A.ports(valid.nodes[0]).some(p=>p.startsWith('no-')));
});

test('règles : repères proches sans recouvrement des cercles et ports bas distincts',()=>{
  const n=A.node('ranges','r');n.params.separators=[15,15.1,15.2,70];n.params.labels=['a','b','c','d','e'];
  const layout=R.ruleLayout(n);assert.ok(layout.h>168);
  for(const a of layout.markers)for(const b of layout.markers)if(a.index!==b.index&&Math.abs(a.x-b.x)<22)assert.notEqual(a.lane,b.lane);
  const ports=A.ports(n).map(p=>R.portPoint(n,p));assert.equal(new Set(ports.map(p=>p.x)).size,5);
  assert.ok(ports.every(p=>p.y===n.y+layout.h));
});

test('vrai éditeur : saisie complète, erreur réversible, molette immédiate, changement de mesure et glisser arrondi',()=>{
  const g=graph();g.nodes.push(A.node('info','info',600,400));const ui=editorSurface('auto',{saved:g});
  ui.receive({type:'centurion-auto-init',graph:g,measurements:catalog,commands:A.actionCatalog(),runtime:A.idle(),values:{},simulationRunning:false});
  ui.event('canvas','click',ui.query('[data-node="rule"]'));
  let input=ui.query('[data-rule-boundary="0"]');input.value='';ui.event('properties','input',input);assert.equal(ui.graph().nodes[0].params.separators[0],15);
  input.value='18';ui.event('properties','input',input);assert.equal(ui.graph().nodes[0].params.separators[0],15);
  ui.event('properties','keydown',input,{key:'Enter'});assert.equal(ui.graph().nodes[0].params.separators[0],18);
  input.value='90';ui.event('properties','change',input);assert.equal(ui.graph().nodes[0].params.separators[0],18);assert.equal(input.getAttribute('aria-invalid'),'true');
  input.value='19.875';ui.event('properties','change',input);assert.equal(ui.graph().nodes[0].params.separators[0],19.875);
  ui.event('properties','wheel',input,{deltaY:-1});assert.equal(ui.graph().nodes[0].params.separators[0],20.9);
  input.value='21.125';ui.focus(input);ui.event('canvas','click',ui.query('[data-node="rule"]'));
  assert.equal(ui.graph().nodes[0].params.separators[0],21.125);ui.focus(null);
  const select=ui.query('select[data-field="variable"]');select.value='pressure';ui.event('properties','change',select);
  assert.deepEqual(ui.graph().nodes[0].params.scale,{min:0,max:180});assert.equal(ui.queryAll('[data-rule-scale]').length,2);
  assert.equal(ui.queryAll('[data-range-field="min"],[data-range-field="max"]').length,0);
  const marker=ui.query('[data-range-boundary="0"]');
  ui.event('canvas','pointerdown',marker,{button:0,clientX:220,clientY:180,pointerId:1});
  ui.event('canvas','pointermove',marker,{clientX:301.45678,clientY:180,pointerId:1});ui.event('canvas','pointerup',marker);
  const value=ui.graph().nodes[0].params.separators[0];assert.equal(value,A.roundRuleValue(value));
  assert.equal(ui.queryAll('.range-marker circle').length,2);assert.equal(ui.queryAll('[data-output][data-port="no-left"]').length,0);
  assert.equal(ui.queryAll('.range-value').length,2);
  assert.equal(ui.query('[data-range-boundary="0"] .range-value').textContent,value.toLocaleString('fr-FR',{maximumSignificantDigits:3}));
  const ruleBox=ui.query('[data-node="rule"]'),band=ruleBox.querySelector('.band-divider');
  assert.ok(ruleBox.querySelector('.name-band'));assert.ok(ruleBox.querySelector('.detail').getAttribute('y')>Number(band.getAttribute('y1')));
  ui.event('canvas','keydown',ui.query('[data-node="info"]'),{key:'Enter'});assert.equal(ui.query('#properties h2').textContent,'Information');
});

test('vrai éditeur : clôture créée, deux curseurs visibles et surlignage durant deux secondes réelles',()=>{
  const ui=editorSurface('auto',{saved:A.emptyGraph()});ui.query('[data-add="parallel"]').click();
  const g=ui.graph(),fork=g.nodes.find(n=>n.type==='parallel'),join=g.nodes.find(n=>n.type==='join');
  assert.equal(fork.params.join,join.id);assert.equal(join.params.fork,fork.id);
  g.nodes.push(A.node('info','recent'),A.node('wait','waiting'));
  const runtime={...A.idle(),status:'running',current:join.id,activeNodes:[join.id,'waiting'],
    tokens:[{current:join.id},{current:'waiting'}],groups:[{join:join.id,arrived:[0],expected:2}],eventSerial:2,
    history:[{node:'recent',name:'Passage',event:'entrée',time:20000,serial:1},{node:'waiting',name:'Attente',event:'entrée',time:20001,serial:2}]};
  ui.receive({type:'centurion-auto-init',graph:g,measurements:catalog,commands:A.actionCatalog(),runtime,values:{},simulationRunning:true});
  assert.equal(ui.queryAll('.box.executing').length,2);assert.ok(ui.query('[data-node="'+join.id+'"]').textContent.includes('1/2'));
  assert.equal(ui.queryAll('.box.recent').length,1);assert.equal(ui.get('stepDelay').disabled,true);
  ui.realTime(1999);assert.equal(ui.queryAll('.box.recent').length,1);
  ui.realTime(2001);assert.equal(ui.queryAll('.box.recent').length,0);assert.equal(ui.queryAll('.box.executing').length,2);
});
