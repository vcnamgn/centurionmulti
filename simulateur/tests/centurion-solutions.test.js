const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('../centurion-engine');
const {editorSurface}=require('./helpers/editor-surface');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../../scripts/cc-solution-tiers.json'),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const reference=require('./helpers/reference-model');
function choose(editor,key,code){
  for(const radio of editor.queryAll('input[name="solutionTier"]'))radio.checked=radio.value===key;
  editor.get('solutionsForm').fire('change');
  editor.get('solutionCode').value=code??[...catalog[editor.mode][key].reverseCode].reverse().join('');
}
function surface(mode,options){const editor=editorSurface(mode,options);editor.mode=mode;return editor;}
const targets={regul:{
  temperature:['posg'],level:['posg','nrefOut','qchargeOut','rcvLetdownCloseOut'],
  pressure:['posg','nrefOut','qchargeOut','pchauffOut','qaspOut','rcvLetdownCloseOut'],
  gv:['gv1Out','gv2Out','gv3Out','gv4Out'],gcp:['g3Out'],
  complete:['posg','nrefOut','qchargeOut','pchauffOut','qaspOut','g3Out','gv1Out','gv2Out','gv3Out','gv4Out','rcvLetdownCloseOut']
},protect:{aar:['aarOut'],aarIs:['aarOut','risOut'],complete:['aarOut','risOut','asgOut']}};

test('première ouverture : deux canevas vides, commandes inactives, aucun automatisme greffé',()=>{
  for(const mode of ['regul','protect']){
    const editor=surface(mode);assert.equal(editor.state().nodes.length,0);
    assert.equal(editor.state().links.length,0);assert.equal(editor.state().enabled,false);
    editor.receive({type:'centurion-editor-enable',enabled:true,signals:E.controlSignals(E.make())});
    editor.receive({type:'centurion-editor-tick',dt:.1,signals:E.controlSignals(E.make())});
    assert.deepEqual(plain(editor.messages.findLast(m=>m.type==='centurion-editor-outputs').outputs),{});
  }
});

test('neuf corrections : bon code, couverture exacte, complet identique aux JSON utilisateur',()=>{
  for(const mode of ['regul','protect']){
    const editor=surface(mode);
    for(const [key,tier] of Object.entries(catalog[mode])){
      editor.get('clearReg').fire('click');editor.get('openSolutions').fire('click');
      assert.equal(editor.get('solutionsDialog').hasAttribute('open'),true);
      assert.equal(editor.queryAll('input[name="solutionTier"]').length,mode==='protect'?3:6);
      choose(editor,key);editor.get('solutionsForm').fire('submit');
      assert.equal(editor.get('solutionsDialog').hasAttribute('open'),false,`${mode}/${key} chargé`);
      const state=editor.state();assert.equal(state.enabled,false);
      if(mode==='regul'&&['level','pressure','complete'].includes(key)){
        const pi=state.nodes.find(n=>n.type==='pi'&&n.label==='PI niveau');
        assert.equal(pi.params.min,-60,`${key} : correction basse du PI niveau`);
        assert.equal(pi.params.max,60,`${key} : correction haute du PI niveau`);
      }
      const expected=targets[mode][key];
      assert.deepEqual(plain(state.nodes.filter(n=>expected.includes(n.type)||/Out$/.test(n.type)||n.type==='posg')
        .map(n=>n.type).sort()),expected.slice().sort());
      editor.receive({type:'centurion-editor-enable',enabled:true,signals:E.controlSignals(E.make())});
      editor.receive({type:'centurion-editor-tick',dt:.1,signals:E.controlSignals(E.make())});
      const output=editor.messages.findLast(m=>m.type==='centurion-editor-outputs').outputs;
      assert.deepEqual(Object.keys(output).sort(),[...expected,...(mode==='regul'&&['pressure','complete'].includes(key)?['prefOut']:[])].sort());
      assert.ok(Object.values(output).every(Number.isFinite));
      if(key==='complete'){
        const original=reference(mode);
        assert.equal(state.nodes.length,original.nodes.length);
        assert.deepEqual(plain(state.links),original.links);
        for(const source of original.nodes){
          const node=state.nodes.find(n=>n.id===source.id);
          for(const prop of ['type','label','x','y'])assert.equal(node[prop],source[prop]);
          for(const [prop,value] of Object.entries(source.params))assert.deepEqual(plain(node.params[prop]),value);
        }
      }
      editor.flushTimers();
      const saved=JSON.parse(editor.storage.get(`centurion-${mode}-autosave-v1`));
      assert.equal(saved.nodes.length,state.nodes.length);
      assert.equal(saved.links.length,state.links.length);
    }
  }
});

test('code incorrect et confirmation : préserver le travail, désactiver la commande, annuler',()=>{
  const original=reference('protect'),editor=surface('protect',{saved:original});
  editor.receive({type:'centurion-editor-enable',enabled:true,signals:E.controlSignals(E.make())});
  editor.get('openSolutions').fire('click');choose(editor,'aar','0000');
  editor.get('solutionsForm').fire('submit');
  assert.match(editor.get('solutionStatus').textContent,/incorrect/);
  assert.equal(editor.state().enabled,true);assert.equal(editor.state().nodes.length,original.nodes.length);
  choose(editor,'aar');editor.get('solutionsForm').fire('submit');
  assert.match(editor.get('solutionStatus').textContent,/remplacera/);
  assert.equal(editor.state().nodes.length,original.nodes.length);
  editor.get('solutionsForm').fire('submit');
  assert.equal(editor.state().enabled,false);
  assert.ok(editor.messages.some(m=>m.type==='centurion-editor-enabled'&&m.mode==='protect'&&!m.enabled));
  assert.equal(editor.state().nodes.some(n=>n.type==='asgOut'||n.type==='risOut'),false);
  editor.get('undoReg').fire('click');
  assert.equal(editor.state().nodes.length,original.nodes.length);
  assert.deepEqual(plain(editor.state().links),original.links);
});

test('protection partielle et travail incomplet restaurés sans ajout de PLIN ou ASG',()=>{
  const saved={format:'SimuREP-Regulation',version:1,name:'Mon exercice',nodeCounter:2,
    nodes:[{id:'N1',type:'constant',label:'Essai',x:0,y:0,params:{value:0,unit:'TOR'}},
      {id:'N2',type:'aarOut',label:'AAR',x:250,y:0,params:{}}],
    links:[{from:'N1',to:'N2',toPort:0}],viewport:{x:0,y:0,zoom:1}};
  const editor=surface('protect',{saved});
  assert.equal(editor.state().enabled,false);
  assert.deepEqual(plain(editor.state().nodes.map(n=>n.type)),['constant','aarOut']);
  assert.deepEqual(plain(editor.state().links),saved.links);
});
