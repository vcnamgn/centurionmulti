const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../centurion-auto'),R=require('../centurion-auto-routing'),E=require('../centurion-engine'),H=require('../centurion-history');
const {editorSurface}=require('./helpers/editor-surface');
const graph=actions=>{
  const g=A.emptyGraph();g.stepDelayS=2;g.nodes=[A.node('start','s'),A.node('action','a'),A.node('end','e')];
  g.nodes[0].params.stepDelayS=0;g.nodes[1].params={actions};g.links=[{id:'sa',from:'s',to:'a',port:'next'},{id:'ae',from:'a',to:'e',port:'next'}];return g;
};
const context=()=>{const ctx={E,model:E.make(),regulationActive:true};
  ctx.setRegulationActive=v=>{ctx.regulationActive=v;};ctx.setProtectionActive=v=>{ctx.model.controls.protectionsEnabled=v;};
  ctx.setRManualOverride=v=>E.setRManualOverride(ctx.model,v);return ctx;};

test('actions groupées : modes puis commandes, application une fois et reprise JSON sans rejeu',()=>{
  const g=graph([{command:'regulation.enabled',value:0},{command:'rods.manual',value:1},{command:'rods.R',value:220},
    {command:'heater',value:500},{command:'rcv.boron',value:1500}]),ctx=context(),r=A.start(g,'s'),calls=[];
  const batch=(actions,check)=>{if(!check)calls.push(...actions.map(a=>a.command));A.executeActions(ctx,actions,check);};
  A.tick(r,g,.1,()=>0,()=>{},batch);A.tick(r,g,.1,()=>0,()=>{},batch);
  assert.equal(ctx.regulationActive,false);assert.equal(ctx.model.controls.rManualPas,220);assert.equal(ctx.model.controls.manualHeaterKW,500);
  assert.equal(calls.length,5);r.status='paused';A.tick(r,g,20,()=>0,()=>{},batch);assert.equal(calls.length,5);
  const saved=A.validateSaved(JSON.parse(JSON.stringify({graph:g,runtime:r})));saved.runtime.status='running';
  for(let i=0;i<50;i++)A.tick(saved.runtime,saved.graph,.1,()=>0,()=>{},batch);
  assert.equal(saved.runtime.status,'complete');assert.equal(calls.length,5);
});

test('actions groupées : erreur en fin de boîte sans application partielle, listes invalides rejetées',()=>{
  const ctx=context(),before=structuredClone(ctx.model),g=graph([{command:'regulation.enabled',value:0},{command:'heater',value:500},{command:'rra.connect',value:1}]);
  assert.throws(()=>A.executeActions(ctx,g.nodes[1].params.actions),/RRA impossible/);
  assert.deepEqual(ctx.model,before);assert.equal(ctx.regulationActive,true);
  for(const actions of [[],Array(25).fill({command:'heater',value:100})]){g.nodes[1].params.actions=actions;assert.throws(()=>A.validate(g),/1 à 24/);}
  g.nodes[1].params.actions=[{command:'heater',value:100},{command:'heater',value:200}];assert.throws(()=>A.validate(g),/une fois/);
  g.nodes[1].params.actions=[{command:'unknown',value:0}];assert.throws(()=>A.validate(g),/inconnue/);
  const legacy=A.node('action','old');assert.deepEqual(A.actionItems(legacy.params),[{command:'turbine.target',value:100}]);
});

test('catalogue : ordre du pupitre, vannes ES/HS et nouveau nom des branches',()=>{
  const defs=A.actionCatalog();assert.deepEqual([...new Set(defs.map(d=>d.group))],['Modes CC','Turbine','Grappes','GV','GMPP','Pressuriseur','RCV','ASG','RIS','RRA']);
  for(const id of ['gv.1.vvp','relief.1','rcv.orifice.2','asg.3'])assert.deepEqual(defs.find(d=>d.id===id).options,[[1,'ES (ouvert)'],[0,'HS (fermé)']]);
  const g=A.emptyGraph();g.nodes=[A.node('parallel','fork')];g.nodes[0].name='Effectuer les X actions en parallèle';
  assert.equal(A.validate(g).nodes[0].name,'Plusieurs actions');g.nodes[0].name='Mon départ parallèle';assert.equal(A.validate(g).nodes[0].name,'Mon départ parallèle');
});

test('largeur : contenu complet, adaptation puis retour à une largeur compacte',()=>{
  const n=A.node('info','info');n.name='Information';n.params.message='Court';const narrow=R.dimensions(n);
  n.params.message='Vérifier la température moyenne et la pression primaire avant de connecter le RRA';const wide=R.dimensions(n);
  assert.ok(wide.w>narrow.w);assert.equal(wide.bodyLines.join(' '),n.params.message);
  n.params.message='Information complète sur le niveau et la pression. '.repeat(40).trim();const tall=R.dimensions(n);
  assert.ok(tall.w<=720);assert.ok(tall.h>wide.h);assert.equal(tall.bodyLines.join(' '),n.params.message);
  n.params.message='Court';assert.equal(R.dimensions(n).w,narrow.w);
});

test('vrai éditeur : ajout, choix, réordonnancement, retrait et affichage des actions',()=>{
  const g=graph([{command:'turbine.target',value:80}]),ui=editorSurface('auto',{saved:g}),defs=A.actionCatalog();
  ui.receive({type:'centurion-auto-init',graph:g,measurements:A.measurementCatalog(E,H,E.make()),commands:defs,runtime:A.idle(),values:{},simulationRunning:false});
  ui.event('canvas','click',ui.query('[data-node="a"]'));ui.event('properties','click',ui.query('#addAction'));
  assert.equal(ui.graph().nodes[1].params.actions.length,2);
  let pick=ui.query('select[data-field="command"][data-index="1"]');pick.value='gv.1.vvp';ui.event('properties','change',pick);
  const value=ui.query('select[data-field="value"][data-index="1"]');assert.ok(value.textContent.includes('HS (fermé)'));
  value.value='0';ui.event('properties','change',value);assert.equal(ui.graph().nodes[1].params.actions[1].value,0);
  ui.event('properties','click',ui.query('[data-move-action="1"]'));assert.equal(ui.graph().nodes[1].params.actions[0].command,'gv.1.vvp');
  assert.ok(ui.query('[data-node="a"]').textContent.includes('HS (fermé)'));
  assert.deepEqual(ui.queryAll('optgroup').slice(0,10).map(e=>e.getAttribute('label')),['Modes CC','Turbine','Grappes','GV','GMPP','Pressuriseur','RCV','ASG','RIS','RRA']);
  ui.event('properties','click',ui.query('[data-remove-action="0"]'));assert.equal(ui.graph().nodes[1].params.actions.length,1);
  assert.equal(ui.graph().nodes[1].params.actions[0].command,'turbine.target');
});
