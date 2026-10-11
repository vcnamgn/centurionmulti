const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../centurion-auto'),B=require('../centurion-auto-editing'),R=require('../centurion-auto-routing');
const {editorSurface}=require('./helpers/editor-surface');
const link=(from,to,port='next')=>({id:from+'-'+port+'-'+to,from,to,port});
function fixture(){
  const g=A.emptyGraph();g.name='Import';g.stepDelayS=5;
  g.nodes=[A.node('start','s',10,10),A.node('parallel','fork',10,180),A.node('info','a',10,420),
    A.node('wait','b',420,420),A.node('join','join',10,650),A.node('end','e',10,850),A.node('start','s2',800,10)];
  g.nodes[0].name='Séquence A';g.nodes[6].name='Séquence B';
  g.nodes[1].params.join='join';g.nodes[4].params.fork='fork';g.nodes[2].params.message='Contrôler le pupitre';
  g.links=[link('s','fork'),link('fork','a','branch:0'),link('fork','b','branch:1'),link('a','join'),link('b','join'),link('join','e'),link('s2','e')];
  return A.validate(g);
}
const surface=g=>editorSurface('auto',{saved:g});
const selected=ui=>ui.queryAll('.box.selected').map(el=>el.dataset.node);
const rect=ui=>{const [x,y,w,h]=ui.get('canvas').getAttribute('viewBox').split(' ').map(Number);return {x,y,w,h};};
const visible=(n,v)=>{const d=R.dimensions(n);return n.x>=v.x&&n.y>=v.y&&n.x+d.w<=v.x+v.w&&n.y+d.h<=v.y+v.h;};
let serial=0;const makeId=prefix=>prefix+'-copy-'+(++serial);

test('copie partielle : liaisons internes et références ouverture/clôture remappées',()=>{
  const g=fixture(),part=B.fragment(g,['fork','a','b']);
  assert.deepEqual(part.nodes.map(n=>n.id),['fork','a','b','join']);
  assert.equal(part.links.length,4);const copy=B.remap(part,g,makeId);
  assert.ok(copy.nodes.every(n=>!g.nodes.some(b=>b.id===n.id)));
  const fork=copy.nodes.find(n=>n.type==='parallel'),join=copy.nodes.find(n=>n.type==='join');
  assert.equal(fork.params.join,join.id);assert.equal(join.params.fork,fork.id);
  assert.ok(copy.links.every(l=>copy.nodes.some(n=>n.id===l.from)&&copy.nodes.some(n=>n.id===l.to)));
  assert.deepEqual(g,fixture());A.validate({...g,nodes:[...g.nodes,...copy.nodes],links:[...g.links,...copy.links]});
});

test('import sélectif : parties communes uniques, noms distincts, durées préservées',()=>{
  const g=fixture(),one=B.sequenceFragment(g,['s']);assert.equal(one.nodes.length,6);
  assert.ok(!one.nodes.some(n=>n.id==='s2'));A.validateExecution(one,'s');
  const all=B.sequenceFragment(g,['s','s2']);assert.equal(all.nodes.length,7);
  const target=A.emptyGraph();target.nodes=[A.node('start','original')];target.nodes[0].name='Séquence A';
  const added=B.remap(one,target,makeId,{preserveDelay:true});
  assert.equal(added.nodes[0].name,'Séquence A (2)');assert.ok(added.nodes.every(n=>n.params.stepDelayS===5));
  const combined=A.validate({...target,nodes:[...target.nodes,...added.nodes],links:added.links});
  A.validateExecution(combined,added.nodes[0].id);
});

test('placement : espace libre visible et dézoomage si une grande boîte ne tient pas',()=>{
  const dimensions=()=>({w:320,h:120}),existing=[{x:24,y:24},{x:376,y:24},{x:24,y:176}],nodes=[{x:0,y:0}];
  const view=B.place(nodes,existing,{x:0,y:0,w:1200,h:700},dimensions);
  assert.deepEqual(view,{x:0,y:0,w:1200,h:700});
  assert.ok(existing.every(n=>!B.overlaps({...nodes[0],...dimensions()},{...n,...dimensions()},31)));
  const huge=[{x:0,y:0}];const expanded=B.place(huge,[],{x:800,y:900,w:250,h:145},()=>({w:720,h:420}));
  assert.ok(expanded.w>=768&&expanded.h>=468);
  assert.ok(huge[0].x>=expanded.x&&huge[0].y+420<=expanded.y+expanded.h);
});

test('éditeur : Shift, copier/coller, undo/redo, suppression groupée et nouvelle édition',()=>{
  const g=A.emptyGraph();g.nodes=[A.node('start','s',24,24),A.node('info','a',24,190),A.node('end','e',600,24)];g.links=[link('s','a'),link('a','e')];
  const ui=surface(g);ui.event('canvas','click',ui.query('[data-node="s"]'));
  ui.event('canvas','click',ui.query('[data-node="a"]'),{shiftKey:true});assert.deepEqual(selected(ui),['s','a']);
  ui.key('c',{ctrlKey:true});ui.key('v',{ctrlKey:true});let added=ui.graph();
  assert.equal(added.nodes.length,5);assert.equal(added.links.length,3);assert.equal(selected(ui).length,2);
  assert.ok(added.nodes.slice(3).every(n=>visible(n,rect(ui))));
  assert.equal(added.nodes[3].name,'Nouvelle séquence (2)');
  ui.key('z',{ctrlKey:true});assert.equal(ui.graph().nodes.length,3);assert.equal(ui.get('redo').disabled,false);
  ui.key('z',{ctrlKey:true,shiftKey:true});assert.deepEqual(ui.graph(),added);
  ui.event('delete','click',ui.get('delete'));assert.equal(ui.graph().nodes.length,3);
  ui.event('undo','click',ui.get('undo'));assert.equal(ui.graph().nodes.length,5);
  ui.query('[data-add="wait"]').click();assert.equal(ui.get('redo').disabled,true);
  assert.equal(ui.graph().nodes.length,6);assert.ok(visible(ui.graph().nodes.at(-1),rect(ui)));
});

test('éditeur : clic Shift réel non doublé, déplacement commun avec un seul undo',()=>{
  const g=A.emptyGraph();g.nodes=[A.node('info','a',24,24),A.node('info','b',500,24)];const ui=surface(g);
  const click=(id,shiftKey=false)=>{let n=ui.query(`[data-node="${id}"]`);
    ui.event('canvas','pointerdown',n,{button:0,clientX:30,clientY:30,pointerId:1,shiftKey});
    ui.event('canvas','pointerup',ui.get('canvas'),{pointerId:1});
    ui.event('canvas','click',ui.query(`[data-node="${id}"]`),{shiftKey});};
  click('a');click('b',true);assert.deepEqual(selected(ui),['a','b']);
  ui.event('canvas','pointerdown',ui.query('[data-node="a"]'),{button:0,clientX:30,clientY:30,pointerId:1});
  ui.event('canvas','pointermove',ui.get('canvas'),{clientX:90,clientY:70});
  ui.event('canvas','pointerup',ui.get('canvas'),{pointerId:1});
  assert.deepEqual(ui.graph().nodes.map(n=>[n.x,n.y]),[[84,64],[560,64]]);
  ui.get('undo').click();assert.deepEqual(ui.graph(),g);ui.get('redo').click();assert.equal(ui.graph().nodes[1].x,560);
});

test('éditeur : déplacement fluide, une image par rafale et dimensions de texte conservées',()=>{
  const g=fixture(),ui=surface(g);const n=ui.query('[data-node="a"]');
  ui.event('canvas','pointerdown',n,{button:0,clientX:40,clientY:430,pointerId:1});
  const pending=ui.pendingFrames,measurements=ui.textMeasurements;
  for(let dy=2;dy<=60;dy+=2)ui.event('canvas','pointermove',ui.get('canvas'),{clientX:90,clientY:430+dy});
  assert.equal(ui.pendingFrames,pending+1);assert.equal(ui.textMeasurements,measurements);
  ui.frame();assert.equal(ui.pendingFrames,pending);assert.equal(ui.textMeasurements,measurements);
  const moved=ui.query('[data-node="a"] .body');assert.equal(moved.getAttribute('x'),'60');assert.equal(moved.getAttribute('y'),'480');
  ui.event('canvas','pointerup',ui.get('canvas'),{pointerId:1});
  assert.equal(ui.graph().nodes.find(n=>n.id==='a').y,480);ui.get('undo').click();assert.deepEqual(ui.graph(),g);
});

test('éditeur : déplacement du canevas sans cumul des mouvements entre deux images',()=>{
  const g=A.emptyGraph();g.nodes=[A.node('info','a',0,0)];const ui=surface(g),before=rect(ui);
  ui.event('canvas','pointerdown',ui.get('paper'),{button:0,clientX:0,clientY:0,pointerId:1});
  for(let x=10;x<=100;x+=10)ui.event('canvas','pointermove',ui.get('canvas'),{clientX:x,clientY:x/2});
  ui.event('canvas','pointerup',ui.get('canvas'),{pointerId:1});
  assert.deepEqual(rect(ui),{...before,x:before.x-100,y:before.y-50});assert.deepEqual(ui.graph(),g);
});

test('éditeur : sélection par rectangle et ajout visible sur un canevas déplacé',()=>{
  const g=A.emptyGraph();g.nodes=[A.node('info','a',24,24),A.node('info','b',500,24),A.node('end','off',9000,9000)];const ui=surface(g);
  ui.event('canvas','pointerdown',ui.get('paper'),{button:0,clientX:0,clientY:0,shiftKey:true,pointerId:1});
  ui.event('canvas','pointermove',ui.get('canvas'),{clientX:850,clientY:180});
  ui.frame();
  assert.ok(ui.query('.selection-rectangle'));ui.event('canvas','pointerup',ui.get('canvas'),{pointerId:1});
  assert.deepEqual(selected(ui),['a','b']);assert.equal(ui.query('.selection-rectangle'),null);
  ui.query('[data-add="parallel"]').click();const added=ui.graph().nodes.slice(3);
  assert.equal(added.length,2);assert.ok(added.every(n=>visible(n,rect(ui))));
  assert.equal(added[0].params.join,added[1].id);
});

test('éditeur : Ouvrir choisit certaines séquences, ajout annulable puis remplacement annulable',async()=>{
  const g=A.emptyGraph();g.nodes=[A.node('start','old',24,24)];const ui=surface(g),imported=fixture();
  const open=async()=>{ui.get('graphFile').files=[{size:4000,text:async()=>JSON.stringify(imported)}];await ui.event('graphFile','change',ui.get('graphFile'));};
  await open();assert.ok(ui.get('importDialog').hasAttribute('open'));assert.equal(ui.get('importMode').value,'append');
  assert.equal(ui.queryAll('[data-sequence]').length,2);ui.get('importNone').click();assert.equal(ui.get('importApply').disabled,true);
  const checkbox=ui.query('[data-sequence="s"]');checkbox.checked=true;ui.event('importSequences','change',checkbox);ui.get('importApply').click();
  let combined=ui.graph();assert.equal(combined.nodes.length,7);assert.ok(combined.nodes.some(n=>n.id==='old'));
  assert.ok(!combined.nodes.some(n=>n.name==='Séquence B'));assert.equal(combined.stepDelayS,2);
  const start=combined.nodes.find(n=>n.name==='Séquence A');A.validateExecution(combined,start.id);
  ui.get('undo').click();assert.deepEqual(ui.graph(),g);ui.get('redo').click();assert.deepEqual(ui.graph(),combined);
  await open();ui.get('importMode').value='replace';ui.event('importMode','change',ui.get('importMode'));ui.get('importApply').click();
  assert.deepEqual(ui.graph(),imported);ui.get('undo').click();assert.deepEqual(ui.graph(),combined);
});

test('éditeur : import de toutes les séquences avec des boîtes sans départ, édition verrouillée',async()=>{
  const g=fixture();g.nodes.push(A.node('info','orphan',1400,100));const ui=surface(A.emptyGraph());
  ui.get('graphFile').files=[{size:4000,text:async()=>JSON.stringify(g)}];await ui.event('graphFile','change',ui.get('graphFile'));
  ui.get('importMode').value='append';ui.event('importMode','change',ui.get('importMode'));ui.get('importApply').click();
  assert.equal(ui.graph().nodes.length,8);assert.equal(ui.graph().links.length,7);
  ui.receive({type:'centurion-auto-state',runtime:{...A.idle(),status:'running',history:[]},values:{},simulationRunning:true});
  assert.ok(ui.get('paste').disabled);assert.ok(ui.get('redo').disabled);assert.ok(ui.get('openGraph').disabled);
  const before=ui.graph();ui.key('v',{ctrlKey:true});ui.key('z',{ctrlKey:true});assert.deepEqual(ui.graph(),before);
});
