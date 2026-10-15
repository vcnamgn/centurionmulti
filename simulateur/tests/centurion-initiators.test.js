const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../centurion-engine.js');
const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../centurion.html'),'utf8');

function countdownHarness() {
  let now=0,nextTimer=0;const timers=new Map();
  const elements={};
  for(const id of ['initiatorCountdown','initiatorCountdownLabel','initiatorCountdownSeconds',
    'cancelInitiator','startBreak','isolateBreak','startSecondaryBreak','isolateSecondaryBreak','tripPrimaryPumps',
    'secondaryBreakGv','secondaryBreakArea','startEjection','startWithdrawal','startVoltage',
    'breakArea','breakLoop','breakBranch','ejectionWorth','resetButton']) {
    elements[id]={value:'',textContent:'',disabled:false,hidden:true,events:{},
      addEventListener(event,handler){this.events[event]=handler;}};
    assert.ok(html.includes(`id="${id}"`));
  }
  Object.assign(elements.breakArea,{value:'300'});elements.breakLoop.value='2';
  elements.breakBranch.value='chaude';elements.ejectionWorth.value='500';
  elements.secondaryBreakGv.value='3';elements.secondaryBreakArea.value='200';
  const ctx=vm.createContext({E,$:id=>elements[id],performance:{now:()=>now},
    setInterval(fn){const id=++nextTimer;timers.set(id,fn);return id;},
    clearInterval(id){timers.delete(id);},render:()=>{},syncInputs:()=>{},
    historyView:{reset(){}},editorSignals:()=>({}),editorReady:{regul:false,protect:false},sendEditorTick:()=>{},stateStatus:()=>{},
    Auto:null,releasePtProbe:()=>{}});
  const functions=app.slice(app.indexOf('  function renderInitiatorCountdown('),app.indexOf('  function setDiagram('));
  const handlers=app.slice(app.indexOf('    $("cancelInitiator").addEventListener'),
    app.indexOf('    document.querySelectorAll(".program-choice")'));
  const reset=app.slice(app.indexOf('    $("resetButton").addEventListener'),
    app.indexOf('    $("simSpeed").addEventListener'));
  vm.runInContext(`let model=E.make(),pendingInitiator=null,initiatorTimer=null,running=false;
    let historyFollowing=true,historyEndS=null,carry=0,regulationActive=false,protectionActive=true;
    let editorTickPending=null,editorCycle=0;
    ${functions}\n${handlers}\n${reset}
    globalThis.getModel=()=>model;`,ctx);
  return {elements,model:()=>ctx.getModel(),click:id=>elements[id].events.click(),
    tick(ms){now+=ms;for(const fn of [...timers.values()])fn();},timers};
}

test('initiateurs : 5, 4, 3, 2, 1 secondes réelles, paramètres mémorisés et départ unique',()=>{
  for(const [button,check] of [
    ['startBreak',m=>assert.equal(m.state.breakAreaCm2,300)],
    ['startSecondaryBreak',m=>assert.equal(m.state.gv[2].secondaryBreakAreaCm2,200)],
    ['startEjection',m=>assert.equal(m.state.ejectWorthPcm,500)],
    ['startWithdrawal',m=>assert.equal(m.state.withdrawalActive,true)],
    ['startVoltage',m=>assert.equal(m.state.lossOfVoltage,true)]]) {
    const h=countdownHarness(),s=h.model().state,before=s.events.length;
    h.click(button);
    assert.equal(h.elements.initiatorCountdown.hidden,false);
    assert.equal(h.elements.initiatorCountdownSeconds.textContent,'5');
    assert.equal(s.events.length,before,'aucun accident dès le clic');
    assert.ok(h.elements.startBreak.disabled&&h.elements.startVoltage.disabled);
    h.elements.breakArea.value='999';h.elements.ejectionWorth.value='100';
    h.click('startVoltage');assert.equal(h.timers.size,1,'un seul initiateur programmé');
    // Le temps simulé peut avancer à ×200 : il ne décompte pas les secondes réelles.
    s.time+=200;
    for(const seconds of [4,3,2,1]) {
      h.tick(1000);assert.equal(h.elements.initiatorCountdownSeconds.textContent,String(seconds));
      assert.equal(s.events.length,before);
    }
    h.tick(999);assert.equal(s.events.length,before);
    h.tick(1);check(h.model());
    assert.equal(h.elements.initiatorCountdown.hidden,true);
    assert.equal(h.elements.startBreak.disabled,false);
    assert.equal(h.timers.size,0);
    const after=s.events.length;h.tick(6000);assert.equal(s.events.length,after);
  }
});

test('initiateur programmé : annulation et réinitialisation empêchent tout départ différé',()=>{
  for(const action of ['cancelInitiator','resetButton']) {
    const h=countdownHarness();h.click('startEjection');h.tick(3000);h.click(action);h.tick(6000);
    assert.equal(h.model().state.ejectWorthPcm,0);
    assert.equal(h.elements.initiatorCountdown.hidden,true);assert.equal(h.timers.size,0);
    h.click('startWithdrawal');h.tick(5000);assert.equal(h.model().state.withdrawalActive,true);
  }
  const h=countdownHarness();h.click('startBreak');h.click('isolateBreak');h.tick(6000);
  assert.equal(h.model().state.breakAreaCm2,0);assert.equal(h.timers.size,0);
  const g=countdownHarness();g.click('startSecondaryBreak');g.click('isolateSecondaryBreak');g.tick(6000);
  assert.equal(g.model().state.gv[2].secondaryBreakAreaCm2,0);assert.equal(g.timers.size,0);
});
