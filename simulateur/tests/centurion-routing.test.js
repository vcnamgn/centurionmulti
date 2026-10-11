const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../centurion-orthogonal-routing'),A=require('../centurion-auto'),R=require('../centurion-auto-routing');
const {editorSurface}=require('./helpers/editor-surface'),referenceModel=require('./helpers/reference-model');
const rect=n=>({left:n.x,top:n.y,right:n.x+n.w,bottom:n.y+n.h});
function clearRoute(route,nodes,from,to){
  assert.equal(route.blocked,false);
  route.points.slice(1).forEach((q,i)=>{
    const p=route.points[i];assert.ok(p.x===q.x||p.y===q.y,'segment orthogonal');
    for(const n of nodes){if(n.id===from&&i===0||n.id===to&&i===route.points.length-2)continue;
      assert.ok(!O.crosses(p,q,rect(n)),`le segment ${i} traverse ${n.id}`);}
  });
}
const request=(from,to,start,end,startDirection='right',endDirection='left')=>({from,to,start,end,startDirection,endDirection});
function ccModel({multiple=false}={}){
  const g=referenceModel('regul'),copy=(type,id,x,y)=>({...structuredClone(g.nodes.find(n=>n.type===type)),id,x,y});
  const source=copy('constant','N1',0,100);source.params={value:42,unit:'bar'};
  const target=copy(multiple?'sum':'gain','N2',450,100);if(!multiple)target.params={k:2,outputUnit:'bar'};
  g.nodes=[source,target,copy('constant','N3',250,90)];g.links=[{from:'N1',to:'N2',toPort:0}];
  if(multiple){g.nodes.push(copy('constant','N4',0,300));g.links.push({from:'N4',to:'N2',toPort:1});}
  g.viewport={x:0,y:0,zoom:1};g.nodeCounter=5;return g;
}
function points(d){
  let p={x:0,y:0};return [...d.matchAll(/([MHV])([^MHV]+)/g)].map(([,command,raw])=>{
    const values=raw.trim().split(/[ ,]+/).map(Number);
    p=command==='M'?{x:values[0],y:values[1]}:command==='H'?{x:values[0],y:p.y}:{x:p.x,y:values[0]};return p;
  });
}

test('route commune : détour CC, cache, boîte déplacée et connexion rapprochée',()=>{
  const router=O.createRouter({padding:4,stub:12});
  const nodes=[{id:'s',x:0,y:100,w:118,h:90},{id:'t',x:450,y:100,w:118,h:90},{id:'obstacle',x:250,y:90,w:118,h:90}];
  const r=request('s','t',{x:118,y:145},{x:450,y:145});let scene=router.prepare(nodes),route=scene.route(r);
  clearRoute(route,nodes,'s','t');assert.ok(route.points.length>2);assert.equal(router.stats.searches,0);
  assert.equal(router.prepare(nodes),scene);assert.equal(scene.route(r),route);assert.equal(router.stats.cacheHits,1);
  const moved=nodes.map(n=>n.id==='obstacle'?{...n,y:400}:n);scene=router.prepare(moved);route=scene.route(r);
  clearRoute(route,moved,'s','t');assert.equal(route.points.length,2);
  const close=[nodes[0],{...nodes[1],x:126}];route=router.prepare(close).route({...r,end:{x:126,y:145}});
  clearRoute(route,close,'s','t');assert.equal(route.points.length,2,'petit intervalle sans faux blocage des accès');
  const angled=[nodes[0],{...nodes[1],x:130}];route=router.prepare(angled).route({...r,end:{x:130,y:160}});
  clearRoute(route,angled,'s','t');assert.ok(route.points.length>2,'accès courts dans un intervalle étroit');
});

test('route commune : recherche de grille dans un passage à plusieurs coudes',()=>{
  const nodes=[{id:'s',x:0,y:100,w:20,h:40},{id:'t',x:580,y:100,w:20,h:40},
    {id:'cap1',x:24,y:0,w:60,h:80},{id:'cap2',x:24,y:180,w:60,h:100},{id:'wall',x:130,y:60,w:60,h:200}];
  const router=O.createRouter(),route=router.prepare(nodes).route(request('s','t',{x:20,y:120},{x:580,y:120}));
  clearRoute(route,nodes,'s','t');assert.equal(router.stats.searches,1);assert.ok(route.points.length>=6);
});

test('route commune : accès obstrué et simplification conservant les demi-tours',()=>{
  const nodes=[{id:'s',x:0,y:0,w:118,h:90},{id:'t',x:400,y:0,w:118,h:90},{id:'o',x:122,y:0,w:118,h:90}];
  const route=O.createRouter({padding:4,stub:12}).prepare(nodes).route(request('s','t',{x:118,y:45},{x:400,y:45}));
  assert.equal(route.blocked,true);assert.deepEqual(route.points,[{x:118,y:45}],'pas de segment à travers la boîte bloquante');
  const turn=[{x:0,y:0},{x:20,y:0},{x:10,y:0},{x:10,y:30}];assert.deepEqual(O.simplify(turn),turn);
});

test('route commune : les valeurs restent sur un segment sans recouvrir les boîtes',()=>{
  const nodes=[{id:'s',x:0,y:100,w:118,h:90},{id:'t',x:450,y:100,w:118,h:90},{id:'o',x:250,y:90,w:118,h:90}];
  const scene=O.createRouter({padding:4,stub:12}).prepare(nodes);
  const route=scene.route(request('s','t',{x:118,y:145},{x:450,y:145})),label=O.labelAnchor(route.points,scene.rects);
  assert.ok(route.points.some((p,i)=>i&&p.y===label.baseY&&route.points[i-1].y===p.y
    &&label.x>=Math.min(p.x,route.points[i-1].x)&&label.x<=Math.max(p.x,route.points[i-1].x)));
  const y=label.baseY+(label.below?28:-10),bounds={left:label.x-37,right:label.x+37,top:y-18,bottom:y+3};
  assert.ok(scene.rects.every(r=>bounds.right<=r.left||bounds.left>=r.right||bounds.bottom<=r.top||bounds.top>=r.bottom));
});

test('Conduite Auto : ports latéraux et liaison remontante contournent les boîtes',()=>{
  const g=A.emptyGraph();g.nodes=[A.node('test','s',400,0),A.node('info','o',400,250),A.node('end','t',400,550)];
  const boxes=g.nodes.map(n=>({...n,...R.dimensions(n)}));
  for(const port of ['yes','no-left','no-right'])clearRoute(R.route(g,{from:'s',to:'t',port}),boxes,'s','t');
  clearRoute(R.route(g,{from:'t',to:'s',port:'next'}),boxes,'t','s');
});

for(const mode of ['regul','protect']){
  test(`éditeur ${mode} : contour des boîtes, entrée correcte et signaux numériques inchangés`,()=>{
    const model=ccModel(),ui=editorSurface(mode,{saved:model});
    const route={points:points(ui.query('[data-reg-route-index="0"]').getAttribute('d')),blocked:false};
    clearRoute(route,model.nodes.map(n=>({...n,w:118,h:90})),'N1','N2');
    assert.deepEqual(route.points[0],{x:118,y:145});assert.deepEqual(route.points.at(-1),{x:450,y:145});
    assert.equal(ui.get('regRoutingStatus').textContent,'');
    assert.match(ui.query('[data-reg-link-index="0"]').textContent,/42,0 bar/);
    const state=ui.state();
    assert.deepEqual(JSON.parse(JSON.stringify(state.links)),model.links);
    const signals=ui.bridge.receive({type:'centurion-editor-save'}).saved;
    assert.deepEqual(JSON.parse(JSON.stringify(signals.graph.links)),model.links);
    ui.bridge.receive({type:'centurion-editor-enable',enabled:true});
    ui.bridge.receive({type:'centurion-editor-tick',dt:.1,signals:{}});
    assert.equal(ui.state().signals.get('N2').value,84);
    const sensorModel=ccModel();sensorModel.nodes[0].type='pow1';sensorModel.nodes[0].params={};
    const sensor=editorSurface(mode,{saved:sensorModel});
    sensor.bridge.receive({type:'centurion-editor-enable',enabled:true});
    sensor.bridge.receive({type:'centurion-editor-tick',dt:.1,signals:{pow1:[135,'% PN']}});
    assert.match(sensor.query('[data-reg-link-index="0"]').textContent,/135,0% PN/);
    assert.equal(sensor.state().signals.get('N2').value,270);
    const multi=editorSurface(mode,{saved:ccModel({multiple:true})});
    assert.deepEqual(points(multi.query('[data-reg-route-index="0"]').getAttribute('d')).at(-1),{x:450,y:122.5});
    assert.deepEqual(points(multi.query('[data-reg-route-index="1"]').getAttribute('d')).at(-1),{x:450,y:145});
  });
  test(`éditeur ${mode} : déplacements regroupés par image, tracé final et annulation`,()=>{
    const model=ccModel(),ui=editorSurface(mode,{saved:model}),el=ui.query('[data-node-id="N3"]');
    ui.get('zoomResetReg').click();
    el.fire('pointerdown',{button:0,clientX:250,clientY:90,pointerId:1});const pending=ui.pendingFrames;
    for(let dy=10;dy<=300;dy+=10)el.fire('pointermove',{clientX:250,clientY:90+dy});
    assert.equal(ui.pendingFrames,pending+1,'une seule image programmée');
    el.fire('pointerup',{pointerId:1});assert.equal(ui.pendingFrames,pending);
    assert.equal(ui.state().nodes.find(n=>n.id==='N3').y,390);
    assert.equal(points(ui.query('[data-reg-route-index="0"]').getAttribute('d')).length,2);
    ui.get('undoReg').click();assert.equal(ui.state().nodes.find(n=>n.id==='N3').y,90);
    ui.get('redoReg').click();assert.equal(ui.state().nodes.find(n=>n.id==='N3').y,390);
    assert.match(ui.query('[data-reg-link-index="0"]').textContent,/42,0 bar/);
  });
}
