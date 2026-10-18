const test=require('node:test'),assert=require('node:assert/strict'),Controls=require('../centurion-session-controls');
function fixture(){
  const listeners={},events=[],make=(id,type,value,min='',max='')=>({id,type,value,min,max,disabled:false,tagName:'INPUT',checked:false,
    dispatchEvent(event){events.push({id,type:event.type,value:this.value,checked:this.checked});},click(){events.push({id,type:'click'});}});
  const refs={heaterInput:make('heaterInput','range','288','0','1440'),asgManual:make('asgManual','checkbox',''),runButton:make('runButton','button',''),campaignSelect:{...make('campaignSelect','select','debut'),tagName:'SELECT',options:[{value:'debut'},{value:'fin'}]},breakArea:make('breakArea','number','300','0','2000'),breakLoop:{...make('breakLoop','select','1'),tagName:'SELECT',options:[{value:'1'},{value:'2'}]},breakBranch:{...make('breakBranch','select','hot'),tagName:'SELECT',options:[{value:'hot'},{value:'cold'}]},startBreak:make('startBreak','button','')};
  const document={getElementById:id=>refs[id]||null,activeElement:null,addEventListener(type,fn){listeners[type]=fn;}};
  const controls=Controls.create({document,isAuxiliary:()=>false,request:()=>{},onStatus:()=>{}});return {controls,events,refs};
}
test('gestes partagés : cibles explicites, bornes, options et disponibilité du maître',()=>{
  const {controls,events,refs}=fixture();
  assert.equal(controls.execute({kind:'ui',target:'heaterInput',event:'input',value:'450'}).ok,true);assert.equal(events.at(-1).value,'450');
  assert.throws(()=>controls.execute({target:'heaterInput',event:'input',value:'5000'}),/limites/);
  assert.throws(()=>controls.execute({target:'campaignSelect',event:'change',value:'inconnu'}),/Choix/);
  assert.throws(()=>controls.execute({target:'model.state.powerPct',event:'input',value:'900'}),/inconnue/);
  refs.runButton.disabled=true;assert.throws(()=>controls.execute({target:'runButton',event:'click'}),/indisponible/);
  controls.execute({target:'asgManual',event:'change',value:true});assert.equal(refs.asgManual.checked,true);
});
test('les initiateurs utilisent le contexte explicite de leur auteur, les sélecteurs restent locaux',()=>{
  const {controls,events,refs}=fixture();controls.execute({target:'startBreak',event:'click',context:{breakArea:'120',breakLoop:'2',breakBranch:'cold'}});
  assert.equal(refs.breakArea.value,'120');assert.equal(refs.breakLoop.value,'2');assert.equal(events.at(-1).id,'startBreak');
  assert.throws(()=>controls.execute({target:'startBreak',event:'click',context:{breakArea:'120'}}),/incomplet/);
  assert.equal(controls.read().some(row=>row.key==='breakArea'),false);
});
