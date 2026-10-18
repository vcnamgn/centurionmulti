const test=require('node:test'),assert=require('node:assert/strict');
const {editorSurface}=require('./helpers/editor-surface'),reference=require('./helpers/reference-model');
const A=require('../centurion-auto');
for(const mode of ['regul','protect']){
  test(`auxiliaire ${mode} : aucune restauration personnelle ni écriture, affichage reçu et aucun calcul CC`,()=>{
    const saved=reference(mode),ui=editorSurface(mode,{saved,shared:true}),key=`centurion-${mode}-autosave-v1`,personal=ui.storage.get(key);
    assert.equal(ui.state().nodes.length,0,'l’autosauvegarde ne rentre pas dans la séance');
    const master=editorSurface(mode,{saved}),data=master.bridge.receive({type:'centurion-editor-session'});
    ui.bridge.receive({type:'centurion-editor-shared-graph',graph:data.graph,revision:3});
    ui.bridge.receive({type:'centurion-editor-shared-display',display:data.display});
    assert.equal(ui.state().nodes.length,saved.nodes.length);assert.equal(ui.storage.get(key),personal);
    const before=JSON.stringify([...ui.state().signals]);ui.bridge.receive({type:'centurion-editor-tick',dt:100,signals:{pow1:[900,'%']}});
    assert.equal(JSON.stringify([...ui.state().signals]),before,'aucun évaluateur n’avance côté auxiliaire');
    ui.get('toggleRegulation').click();assert.ok(ui.messages.some(m=>m.type==='centurion-editor-enabled'));assert.equal(ui.storage.get(key),personal);
  });
  test(`maître ${mode} : déplacer un graphe partagé garde les mémoires et l’activation`,()=>{
    const ui=editorSurface(mode,{saved:reference(mode)});ui.bridge.receive({type:'centurion-editor-enable',enabled:true});ui.bridge.receive({type:'centurion-editor-tick',dt:.1,signals:{}});
    const before=ui.bridge.receive({type:'centurion-editor-save'}).saved,graph=structuredClone(before.graph);graph.nodes[0].x+=20;
    const result=ui.bridge.receive({type:'centurion-editor-apply-graph',graph,replace:false});assert.equal(result.ok,true);assert.equal(result.enabled,true);
    const after=ui.bridge.receive({type:'centurion-editor-save'}).saved;
    assert.equal(after.enabled,true);assert.deepEqual(JSON.parse(JSON.stringify(after.runtime)),JSON.parse(JSON.stringify(before.runtime)));
    assert.equal(after.graph.nodes[0].x,graph.nodes[0].x);
  });
}
test('auxiliaire Conduite Auto : le diagramme reçu laisse la bibliothèque personnelle intacte',()=>{
  const saved=A.emptyGraph();saved.name='Personnel';saved.nodes=[A.node('start','personal',100,100)];
  const ui=editorSurface('auto',{saved,shared:true}),personal=ui.storage.get('centurion.conduite-auto.v1');
  const common=A.emptyGraph();common.name='Commun';common.nodes=[A.node('start','common',100,100)];
  ui.receive({type:'centurion-auto-init',graph:common,sharedRevision:2,measurements:[],commands:A.actionCatalog(),runtime:A.idle(),values:{},simulationRunning:false});
  assert.equal(ui.get('graphName').value,'Commun');assert.equal(ui.storage.get('centurion.conduite-auto.v1'),personal);
  ui.get('graphName').value='Partagé modifié';ui.event('graphName','input',ui.get('graphName'));ui.flushTimers();
  assert.ok(ui.messages.some(m=>m.type==='centurion-auto-graph'&&m.revision===2));assert.equal(ui.storage.get('centurion.conduite-auto.v1'),personal);
});

test('conflit Auto : conserver le brouillon et proposer la version partagée sans autosauvegarde personnelle',()=>{
  const ui=editorSurface('auto',{saved:A.emptyGraph(),shared:true}),graph=A.emptyGraph();
  graph.name='Commun';const init={type:'centurion-auto-init',graph,sharedRevision:2,measurements:[],commands:A.actionCatalog(),runtime:A.idle(),values:{},simulationRunning:false};
  ui.receive(init);ui.get('graphName').value='Mon brouillon';ui.event('graphName','input',ui.get('graphName'));ui.flushTimers();
  const sent=ui.messages.findLast(m=>m.type==='centurion-auto-graph');assert.ok(sent);
  const updated=structuredClone(graph);updated.name='Autre participant';ui.receive({...init,graph:updated,sharedRevision:3});
  ui.receive({type:'centurion-auto-edit-result',serial:sent.serial,result:{ok:false,error:'schema_conflict',message:'Édition concurrente'}});
  assert.equal(ui.get('graphName').value,'Mon brouillon');assert.equal(ui.get('sharedReloadAuto').hidden,false);
  assert.match(ui.get('editStatus').textContent,/brouillon reste exportable/);
  ui.get('sharedReloadAuto').click();assert.equal(ui.get('graphName').value,'Autre participant');
});
