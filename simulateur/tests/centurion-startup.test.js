const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../centurion-engine');
const State=require('../centurion-state');
const H=require('../centurion-history');
const {svgSurface}=require('./helpers/svg-surface');
const html=fs.readFileSync(path.join(__dirname,'../centurion.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');

// Exécution de l'application entière : vrais événements et vrais pas physiques.
// Seule la surface DOM/Canvas est remplacée ; aucune fonction applicative n'est extraite.
function application(source=app,onPostMessage=null,engine=E,editorBridges={}, {svgUpdates=true,autoModule=null}={}){
  const ids=new Map(),nodes=[],frames=[],windowEvents={},messages=[],downloads=[];
  let now=0,currentSvg=svgSurface('synoptique-RCP-1300.svg');
  const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v])=>[k,v]));
  function matches(node,selector){
    if(selector.includes(' '))return false;
    const id=/#([\w-]+)/.exec(selector)?.[1];
    const tag=/^[a-z]+/.exec(selector)?.[0];
    return (!id||id===node.id)&&(!tag||tag===node.localName)
      &&[...selector.matchAll(/\.([\w-]+)/g)].every(([,name])=>node.classList.contains(name))
      &&[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
        .every(([,key,value])=>key in node.attrs&&(value===undefined||node.attrs[key]===value));
  }
  function register(fragment){
    for(const match of fragment.matchAll(/<([a-z][\w-]*)\b[^>]*>/g)){
      const attrs=attributes(match[0]),classes=new Set((attrs.class||'').split(/\s+/));
      const listeners={};let inner='';
      const node={attrs,id:attrs.id,localName:match[1],value:attrs.value||'',textContent:'',
        min:attrs.min||'',max:attrs.max||'',step:attrs.step||'1',checked:/\bchecked\b/.test(match[0]),
        disabled:/\bdisabled\b/.test(match[0]),style:{},
        dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-'))
          .map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),
        classList:{contains:name=>classes.has(name),add:name=>classes.add(name),remove:name=>classes.delete(name),
          toggle:(name,on)=>on===undefined?(classes.has(name)?classes.delete(name):classes.add(name))
            :on?classes.add(name):classes.delete(name)},
        addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),
        fire(name,extra={}){return Promise.all((listeners[name]||[]).map(fn=>fn({target:node,preventDefault(){},...extra})));},
        click(){return node.fire('click');},
        setAttribute:(key,value)=>{attrs[key]=String(value);},getAttribute:key=>attrs[key],
        matches:selector=>matches(node,selector),
        querySelector:selector=>selector==='strong'?node.tagLabel:null,
        tagLabel:{textContent:''},parentElement:{querySelector:()=>({textContent:''}),classList:{toggle(){}}},
        getBoundingClientRect:()=>({width:800,height:450}),
        getContext:()=>new Proxy({measureText:text=>({width:String(text).length*7})},{get:(o,k)=>o[k]||(()=>{})}),
        get innerHTML(){return inner;},set innerHTML(value){inner=String(value);register(inner);},
        contentDocument:null,contentWindow:{CenturionCC:editorBridges[attrs.id],postMessage(data){messages.push(data);onPostMessage?.(node.id,data);
          if(svgUpdates&&data.type==='centurion-state')currentSvg.update(data);}}};
      nodes.push(node);if(node.id)ids.set(node.id,node);
    }
  }
  register(html);
  for(const [,id,body] of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
    const options=[...body.matchAll(/<option\b[^>]*>/g)];
    const option=options.find(m=>/\bselected\b/.test(m[0]))||options[0];
    ids.get(id).value=option?attributes(option[0]).value:'';
  }
  Object.defineProperty(ids.get('diagramObject'),'data',{set(value){
    currentSvg=svgSurface(value.split('/').at(-1));ids.get('diagramObject').fire('load');}});
  const document={getElementById:id=>ids.get(id)||null,activeElement:null,createElement:()=>({click(){}}),
    querySelectorAll:selector=>nodes.filter(n=>matches(n,selector)),
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}};
  const context=vm.createContext({window:{CenturionEngine:engine,CenturionHistory:H,CenturionState:State,CenturionAuto:autoModule,devicePixelRatio:1,
    addEventListener:(name,fn)=>(windowEvents[name]??=[]).push(fn)},document,
    performance:{now:()=>now},requestAnimationFrame:fn=>frames.push(fn),
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},Blob,
    URL:{createObjectURL(blob){downloads.push(blob);return 'blob:test';},revokeObjectURL(){}},console});
  vm.runInContext(source,context,{filename:'centurion-app.js'});
  return {get:id=>ids.get(id),query:selector=>document.querySelector(selector),messages,downloads,get pendingFrames(){return frames.length;},
    receive(data,source){for(const fn of windowEvents.message||[])fn({data,source});},
    key(event){for(const fn of windowEvents.keydown||[])fn(event);},
    click:id=>ids.get(id).fire('click'),consumeCpu:milliseconds=>{now+=milliseconds;},
    frame(milliseconds=100){now+=milliseconds;const callback=frames.shift();
      assert.ok(callback,'une trame doit être programmée');callback(now);},
    get snapshot(){return messages.findLast(m=>m.type==='centurion-state');}};
}

test('pupitre GMPP : déclenchement manuel disponible avec CC actifs, sans AAR ni IS',()=>{
  const model=E.make();let made=false;
  const page=application(app,null,{...E,make:()=>{if(made)return E.make();made=true;return model;}});
  page.click('toggleRegulationSynoptic');page.click('toggleProtectionSynoptic');
  assert.equal(page.get('tripPrimaryPumps').disabled,false);
  page.click('tripPrimaryPumps');
  assert.equal(model.state.primaryPumpsStopped,true);assert.equal(model.state.pumpHeatMW,0);
  assert.equal(model.state.tripDemandAt,null);assert.equal(model.state.risDemandAt,null);
  assert.match(page.get('primaryPumpStatus').textContent,/Déclenchement manuel/);
  assert.equal(page.get('tripPrimaryPumps').disabled,true);
});

test('pupitre PTUR : pente par défaut, cible maintenue, rampe physique et Instantanée',()=>{
  const model=E.make();let made=false;
  const page=application(app,null,{...E,make:()=>{if(made)return E.make();made=true;return model;}});
  assert.equal(page.get('turbineRateInput').value,'5');
  page.get('demandInput').value='80';page.get('demandInput').fire('input');
  assert.equal(model.controls.manualTurbineTargetPct,80);
  assert.equal(model.state.demandPct,100,'pause : aucune avance du temps physique');
  page.get('simSpeed').value='1';page.get('simSpeed').fire('change');page.click('runButton');
  for(let i=0;i<10;i++)page.frame(100);
  assert.ok(Math.abs(model.state.demandPct-(100-5/60))<1e-8);
  assert.equal(Number(page.get('demandInput').value),80);
  assert.equal(page.get('manualTurbineProgress').hidden,false);
  page.get('turbineRateInput').value='instant';page.get('turbineRateInput').fire('change');page.frame(200);
  assert.equal(model.state.demandPct,80);assert.equal(model.state.turbinePct,80);
  assert.equal(page.get('manualTurbineProgress').hidden,true);
  page.get('transientSelect').value='down';page.click('startTransient');
  assert.equal(page.get('turbineRateInput').disabled,true);
  assert.equal(model.controls.manualTurbineTargetPct,null);
  page.click('interruptTransient');assert.equal(page.get('turbineRateInput').disabled,false);
  page.click('resetButton');assert.equal(page.get('turbineRateInput').value,'5');
});

test('démarrage complet : initialisation, Démarrer, horloge et publication des mesures',()=>{
  const page=application();
  assert.equal(page.pendingFrames,1,'initialisation terminée et animation programmée');
  assert.equal(page.get('runButton').textContent,'Démarrer');
  assert.equal(page.get('protectionsEnabled').checked,false);
  assert.equal(page.get('toggleProtectionSynoptic').textContent,'Activer protection');
  page.receive({type:'centurion-editor-ready',mode:'protect'});
  assert.equal(page.messages.findLast(m=>m.type==='centurion-editor-enable')?.enabled,false);
  assert.equal(page.get('simClock').textContent,'00:00:00');
  assert.equal(page.get('rcvFlowValue').textContent,'36,0 m³/h');
  assert.equal(page.get('rcvLetdownValue').textContent,'36,0 m³/h');
  page.click('runButton');
  assert.equal(page.get('runButton').textContent,'Pause');
  for(let i=0;i<5;i++)page.frame();
  assert.equal(page.get('runIndicator').textContent,'EN COURS');
  assert.ok(page.snapshot.time>7,'le moteur physique avance après le clic');
  assert.notEqual(page.get('simClock').textContent,'00:00:00');
  assert.equal(page.pendingFrames,1,'la boucle poursuit ses trames après l’affichage');
});

test('application : arrêt RIS indépendant de la brèche et reprise JSON en pause',async()=>{
  const m=E.make();E.initiate(m,'break',{areaCm2:300,loop:2});E.initiate(m,'ris');
  E.advance(m,20);
  const {page,flush}=connectedApplication({synchronous:true,engine:{...E,make:()=>m}});
  await page.click('risPumpStop');flush();
  assert.equal(m.controls.breakAreaCm2,300);assert.equal(m.state.breakAreaCm2,300);
  assert.match(page.get('risManualStatus').textContent,/brèche toujours ouverte : 300/);
  await page.click('saveState');
  assert.match(page.get('stateStatus').textContent,/sauvegardé/);
  const text=await page.downloads.at(-1).text(),saved=JSON.parse(text);
  assert.equal(saved.model.controls.risPumpMode,'off');assert.equal(saved.model.controls.breakAreaCm2,300);
  const file=page.get('stateFile');file.files=[{size:text.length,text:async()=>text}];
  await file.fire('change');flush();
  assert.match(page.get('stateStatus').textContent,/chargé.*en pause/);
  assert.equal(page.get('runIndicator').textContent,'EN PAUSE');
  assert.equal(page.snapshot.time,saved.model.state.time);
  await page.click('runButton');page.frame(150);flush();page.frame(150);flush();
  assert.ok(page.snapshot.time>saved.model.state.time);
  assert.ok(page.snapshot.massBalance.breakKgS>0);
  await page.click('resetButton');
  assert.doesNotMatch(page.get('stateStatus').textContent,/État chargé/);
});

test('application : bilan CPP lisible, débits réalisés et soupapes toujours commandables',()=>{
  const m=E.make();m.controls.protectionGraphMode=true;m.controls.manualReliefStages=[true,false,false];
  E.step(m,.1);
  const {page,flush}=connectedApplication({engine:{...E,make:()=>m}});
  page.query('[data-diagram="inventory"]').fire('click');
  assert.equal(page.get('inventoryBalance').hidden,false);
  assert.equal(page.get('instrumentBoard').hidden,true);
  for(const key of ['chargeKgS','risMpKgS','risBpKgS','accumulatorKgS','risKgS','inputKgS',
    'letdownKgS','breakKgS','breakLiquidKgS','breakSteamKgS','reliefKgS','outputKgS','netKgS',
    'totalRateKgS','liquidRateKgS','vaporRateKgS','phaseChangeKgS']){
    const output=page.query(`[data-mass-balance="${key}"]`);
    assert.ok(output,`${key} visible`);
    assert.equal(output.textContent,E.primaryMassBalance(m.state)[key].toLocaleString('fr-FR',
      {minimumFractionDigits:1,maximumFractionDigits:1}));
  }
  assert.equal(page.get('inventoryBalanceTrend').textContent,'Inventaire total en baisse');
  assert.equal(page.get('inventoryBalanceNet').dataset.sign,'loss');
  assert.match(page.get('reliefStatus').textContent,/50,0 kg\/s.*1\/3/);
  assert.match(page.get('reliefStatus').textContent,/automatique.*166 \/ 170 \/ 172/);
  assert.match(page.get('inventoryRisSource').textContent,/2\s?315.*2\s?500 ppm/);
  assert.match(page.get('inventorySump').textContent,/EAS.*< 90/);
  assert.match(page.get('inventoryCoreFlow').textContent,/Cœur.*RIS traversant/);
  assert.match(page.get('inventoryPumpHeat').textContent,/24,0 MWth.*primaire/);
  assert.match(page.get('inventoryLoopReason1').textContent,/apport GMPP 6,0 MWth/);
  assert.equal(page.get('boardPumpHeat').textContent,'24,0 MWth');
  assert.match(page.get('inventoryLoopStatus1').textContent,/Circulation forcée/);
  assert.match(page.get('inventoryLoopFlow1').textContent,/Forcé.*naturel.*total/);
  assert.equal(page.query('[data-flow-condition="reliefBoronPpm"]').textContent,'0');
  assert.equal(page.query('[data-flow-condition="risMpBoronPpm"]').textContent,'—');
  page.click('toggleRegulationSynoptic');flush();
  const relief=page.query('[data-relief-stage="1"]');assert.equal(relief.disabled,false);
  relief.checked=true;relief.fire('change');page.click('runButton');
  for(let i=0;i<3;i++){page.frame(100);flush();}
  assert.equal(page.snapshot.reliefStages[1],true);
  assert.ok(page.snapshot.reliefKgS>99);
  page.query('[data-diagram="pzr"]').fire('click');
  assert.equal(page.get('inventoryBalance').hidden,true);
  assert.equal(page.get('instrumentBoard').hidden,false);
});

test('Modèle : Détails par chapitres, paramètres et alarmes conservés, codes discrets',()=>{
  const page=application();
  assert.equal(page.query('[data-model-page="principes"]'),null);
  assert.equal(page.query('[data-model-page="physique"]'),null);
  assert.ok(page.get('model-details').classList.contains('active'));
  page.query('[data-detail-page="5"]').fire('click');
  assert.ok(page.get('model-detail-5').classList.contains('active'));
  assert.equal(page.get('model-detail-1').classList.contains('active'),false);
  page.query('[data-detail-page="complements"]').fire('click');
  assert.ok(page.get('model-detail-complements').classList.contains('active'));
  assert.equal(page.query('.teacher-solutions').getAttribute('open'),undefined);
  page.query('[data-model-page="parametres"]').fire('click');
  assert.ok(page.get('model-parametres').classList.contains('active'));
  assert.ok(page.get('moderatorCoefficient'));assert.ok(page.get('xenonWorth'));
  page.query('[data-model-page="alarmes"]').fire('click');
  assert.ok(page.get('model-alarmes').classList.contains('active'));
  assert.ok(page.get('alarmRows'));
});

test('application complète : nouvelles vues, fenêtres P–T et commandes manuelles de sûreté',()=>{
  const page=application();
  page.query('[data-diagram="pt"]').fire('click');
  assert.equal(page.get('ptTrailPicker').hidden,false);
  assert.ok(page.snapshot.ptCurves.lower.length>500);
  assert.equal(page.snapshot.ptHistory.length,1,'le point courant apparaît même sans historique');
  page.get('ptTrailWindow').value='14400';page.get('ptTrailWindow').fire('change');
  page.query('[data-diagram="inventory"]').fire('click');
  assert.equal(page.get('ptTrailPicker').hidden,true);
  assert.ok(page.snapshot.inventory.components.gv4.massKg>0);
  assert.equal(page.query('[data-asg-train="0"]').disabled,true);
  page.get('asgManual').checked=true;page.get('asgManual').fire('change');
  assert.equal(page.query('[data-asg-train="0"]').disabled,false);
  page.click('risPumpStop');assert.equal(page.snapshot.risPumpMode,'off');
  page.click('risPumpStart');assert.equal(page.snapshot.risPumpMode,'on');
  page.get('risSource').value='recirculation';page.get('risSource').fire('change');
  assert.equal(page.snapshot.risSourceMode,'recirculation');
  page.click('risPumpAuto');assert.equal(page.snapshot.risPumpMode,'auto');
});

test('application complète : fins rouge/verte visibles et moteur arrêté jusqu’à Réinitialiser',()=>{
  const danger=application();
  danger.click('startBreak');assert.equal(danger.get('initiatorCountdown').hidden,false);
  danger.get('fxyUngraped').value='2.5';danger.get('fxyUngraped').fire('input');
  danger.get('simSpeed').value='200';danger.get('simSpeed').fire('change');
  danger.click('runButton');danger.frame(150);danger.frame(150);
  assert.equal(danger.get('scenarioEnd').hidden,true);
  assert.equal(danger.get('coreDamageCountdown').hidden,false);
  assert.equal(danger.get('coreDamageSeconds').textContent,'5');
  assert.equal(danger.get('simSpeed').value,'1');assert.equal(danger.get('simSpeed').disabled,true);
  const warningTime=danger.snapshot.time;
  for(let i=0;i<12;i++)danger.frame(100);
  assert.ok(danger.snapshot.time-warningTime<1.4,'pas de temps accéléré restant');
  for(let i=0;i<45;i++)danger.frame(100);
  assert.equal(danger.get('scenarioEndTitle').textContent,'Cœur fondu');
  assert.equal(danger.get('scenarioEnd').hidden,false);assert.equal(danger.get('runButton').disabled,true);
  assert.equal(danger.get('initiatorCountdown').hidden,true,'la fin annule le départ en attente');
  assert.equal(danger.get('startBreak').disabled,true);
  const t=danger.snapshot.time;danger.frame(150);assert.equal(danger.snapshot.time,t);
  danger.click('resetButton');assert.equal(danger.get('scenarioEnd').hidden,true);
  assert.equal(danger.get('runButton').disabled,false);
  assert.equal(danger.get('startBreak').disabled,false);
  const safeEngine={...E,make(){const m=E.make();Object.assign(m.state,
    {tavgC:150,pressureBar:27,powerPct:.001,reactivityPcm:-5500});return m;}};
  const safe=application(app,null,safeEngine);assert.equal(safe.get('connectRra').disabled,false);
  safe.click('connectRra');assert.equal(safe.get('scenarioEndTitle').textContent,'Cœur sain et sauf');
  assert.equal(safe.get('scenarioEnd').classList.contains('safe'),true);
  assert.equal(safe.snapshot.rraConnected,true);assert.equal(safe.get('runButton').disabled,true);
  assert.equal(safe.snapshot.operatingState.code,'AN/GV');assert.equal(safe.snapshot.tripAt,null);
});

test('application complète : fenêtre de trace P–T et alarmes sur les vrais sélecteurs Cœur/P–T',()=>{
  const engine={...E,make(){const m=E.make();m.state.time=3600;
    m.state.history=[0,2999,3300,3500,3600].map(t=>({t,tavg:306.5,pressure:155}));
    m.state.dpaxPctPn=10;m.state.dpaxRightExceeded=true;m.state.pressureBar=161;return m;}};
  const page=application(app,null,engine);page.query('[data-diagram="pt"]').fire('click');
  assert.equal(page.snapshot.ptHistory[0].t,3300,'5 minutes glissantes');
  for(const [window,start] of [['300',3300],['1800',2999],['3600',0],['14400',0]]){
    page.get('ptTrailWindow').value=window;page.get('ptTrailWindow').fire('change');
    assert.equal(page.snapshot.ptHistory[0].t,start,`${window} secondes de trace`);
  }
  assert.equal(page.query('[data-diagram="core"]').classList.contains('diagram-alarm'),true);
  assert.equal(page.query('[data-diagram="pt"]').classList.contains('diagram-alarm'),true);
  assert.equal(page.query('[data-diagram="gv"]').classList.contains('diagram-alarm'),false);
});

test('application complète : état AN/GV affiché et alarme du cas fourni, puis CIA dès demande IS',()=>{
  const engine={...E,make(){const m=E.make();Object.assign(m.state,
    {tavgC:227.2,pressureBar:155,powerPct:.001,reactivityPcm:-5500});return m;}};
  const page=application(app,null,engine);page.query('[data-diagram="pt"]').fire('click');
  assert.equal(page.get('plantState').textContent,'AN/GV');
  assert.equal(page.snapshot.operatingState.code,'AN/GV');
  assert.equal(page.query('[data-diagram="pt"]').classList.contains('diagram-alarm'),true);
  page.click('risPumpStart');
  assert.equal(page.get('plantState').textContent,'CIA');
  assert.equal(page.snapshot.operatingState.standardApplicable,false);
  assert.equal(page.query('[data-diagram="pt"]').classList.contains('diagram-alarm'),false);
});

const {editorSurface}=require('./helpers/editor-surface');
function connectedApplication({synchronous=false,engine=E,svgUpdates=true}={}){
  // Les éditeurs ont déjà chargé : leurs notifications initiales sont perdues.
  // La page principale doit donc établir elle-même la connexion.
  const regul=editorSurface('regul',{saved:referenceModel('regul')}),
    protect=editorSurface('protect',{saved:referenceModel('protect')}),queue=[];
  const editors={regulationEditor:regul,protectionEditor:protect};
  const bridges=synchronous?Object.fromEntries(Object.entries(editors).map(([id,editor])=>[id,editor.bridge])):{};
  const page=application(app,(id,data)=>{if(editors[id])queue.push([id,data]);},engine,bridges,{svgUpdates});
  let delivered={regulationEditor:regul.messages.length,protectionEditor:protect.messages.length};
  function flush(){
    let guard=0;
    for(const [id,editor] of Object.entries(editors))
      while(delivered[id]<editor.messages.length)page.receive(editor.messages[delivered[id]++]);
    while(queue.length){
      assert.ok(++guard<10000,'le dialogue ne doit pas tourner en boucle');
      const [id,data]=queue.shift(),editor=editors[id];editor.receive(data);
      while(delivered[id]<editor.messages.length)page.receive(editor.messages[delivered[id]++]);
    }
  }
  flush();page.click('toggleProtectionSynoptic');flush();return {page,regul,protect,flush};
}

function referenceModel(mode){
  return require('./helpers/reference-model')(mode);
}

test('application : commandes groupées hors CIA et aspersion auxiliaire toujours manuelle',()=>{
  const page=application();page.click('toggleRegulationSynoptic');
  assert.equal(page.get('auxiliarySprayInput').disabled,false);
  page.get('auxiliarySprayInput').value='8';page.get('auxiliarySprayInput').fire('input');
  assert.equal(page.get('auxiliarySprayValue').textContent,'8,0 m³/h');
  page.click('allRodsDown');page.frame(150);
  assert.equal(page.snapshot.allRodsTargetPas,0);assert.notEqual(page.snapshot.operatingState.code,'CIA');
  assert.ok(page.snapshot.rods.SA<260);assert.equal(page.get('rManualInput').disabled,true);
  assert.equal(Number(page.get('rManualInput').value),page.snapshot.rods.R);
  page.click('allRodsRelease');assert.equal(page.snapshot.allRodsTargetPas,null);
  page.click('toggleRegulationSynoptic');page.click('allRodsUp');
  assert.equal(page.get('rManualInput').disabled,true,'la commande groupée surcharge aussi la conduite manuelle');
  page.click('allRodsRelease');assert.equal(page.get('rManualInput').disabled,false);
  page.click('asgStart');assert.equal(page.snapshot.asgDemandAt,page.snapshot.time);
  assert.equal(page.snapshot.asgAt,null);assert.notEqual(page.snapshot.operatingState.code,'CIA');
  assert.match(page.get('asgOrderStatus').textContent,/reçu/);
});

test('application complète : haut niveau ASG bloque ES aussi en manuel et affiche HS',()=>{
  const m=E.make(),g=m.state.gv[0];
  g.waterKg=E.C.gvKgPerMetre*17;Object.assign(g,E.gvLevels(g.waterKg));
  m.state.asgAt=0;g.asgRunning=false;
  const page=application(app,null,{...E,make:()=>m});
  assert.equal(page.get('asgOrderStatus').classList.contains('alarm-blink'),true);
  page.get('asgManual').checked=true;page.get('asgManual').fire('change');
  const train=page.query('[data-asg-train="0"]');
  assert.equal(train.disabled,true);assert.equal(train.checked,false);
  assert.equal(page.get('asgTrainStatus0').textContent,'HS');
  assert.match(page.get('asgTrainStatus0').title,/90/);
  train.checked=true;train.fire('change');assert.equal(train.checked,false);
  assert.equal(m.controls.asgTrainEnabled[0],false);
  assert.match(page.get('asgOrderStatus').textContent,/arrêtée sur haut niveau.*GV 1/);
  assert.equal(page.get('asgOrderStatus').classList.contains('alarm-blink'),true);
  g.waterKg=E.C.gvKgPerMetre*(12.5+4.5*.5);Object.assign(g,E.gvLevels(g.waterKg));
  page.get('asgManual').fire('change');assert.equal(train.disabled,false);
  assert.equal(train.checked,false);assert.equal(page.get('asgOrderStatus').classList.contains('alarm-blink'),false);
  train.checked=true;train.fire('change');assert.equal(m.controls.asgTrainEnabled[0],true);
  page.get('asgManual').checked=false;page.get('asgManual').fire('change');
  assert.equal(page.get('asgOrderStatus').classList.contains('alarm-blink'),false);
  assert.equal(page.query('[data-asg-train="0"]').disabled,true);
  assert.match(page.get('boardAsg').title,/arrêtée.*reprise sous 10/);
});

test('application + vrai CC-PROTECT : ordre ASG sur AAR, inhibition CC et démarrage manuel',()=>{
  const {page,protect,flush}=connectedApplication();
  assert.ok(protect.state().nodes.some(n=>n.type==='asgOut'));
  page.click('toggleProtectionSynoptic');flush();page.click('forceTrip');flush();
  page.click('runButton');for(let i=0;i<10;i++){page.frame(100);flush();}
  assert.equal(page.snapshot.asgDemandAt,null,'AAR seul ne démarre pas ASG');
  assert.equal(page.snapshot.gvAll[0].asgKgS,0);
  page.click('toggleProtectionSynoptic');flush();page.frame(100);flush();page.frame(100);flush();
  assert.notEqual(page.snapshot.asgDemandAt,null,'la sortie du graphe émet réellement l’ordre');
  for(let i=0;i<5;i++){page.frame(100);flush();}
  assert.ok(page.snapshot.gvAll.every(g=>g.asgKgS>0));
  assert.equal(protect.messages.findLast(m=>m.type==='centurion-editor-outputs').outputs.asgOut,1);
});

test('CC réels déjà chargés : connexion, mesures, sorties actives et animation en pause',()=>{
  const {page,regul,protect,flush}=connectedApplication();
  assert.equal(regul.state().enabled,false);assert.equal(protect.state().enabled,true);
  page.click('toggleRegulationSynoptic');flush();
  assert.equal(regul.state().enabled,true);
  assert.match(regul.get('regModeState').textContent,/QCHARGE/);
  assert.match(regul.get('regSpeed').textContent,/233.*pas extraits/);
  // Les sources se rafraîchissent aussi lorsque la simulation est en pause.
  page.get('gvSetpoint').value='60';page.get('gvSetpoint').fire('input');
  page.frame(200);flush();
  const graph=regul.state(),source=graph.nodes.find(n=>n.type==='gvSetpointSignal');
  assert.ok(source);
  assert.equal(graph.signals.get(source.id).value,60);
  page.click('runButton');
  for(let i=0;i<8;i++){page.frame(100);flush();regul.frame(i*100);protect.frame(i*100);}
  const output=regul.messages.findLast(m=>m.type==='centurion-editor-outputs');
  assert.ok(Number.isFinite(output.outputs.posg));assert.ok(Number.isFinite(output.outputs.qchargeOut));
  page.frame(200);flush();
  assert.equal(page.snapshot.heaterKW,output.outputs.pchauffOut,
    'le pas physique suivant applique la commande reçue du CC');
  assert.ok(page.snapshot.time>10);assert.equal(regul.pendingFrames,1);
  regul.get('clearReg').click();flush();assert.equal(regul.state().enabled,false);
  assert.equal(page.get('toggleRegulationSynoptic').textContent,'Activer régulations');
  assert.equal(page.get('rManualInput').disabled,false,
    'effacer le graphe rend effectivement la main au pupitre principal');
});

test('éditeur complet : activation suit la position réelle, graphes sauvegardés et noms de sorties',()=>{
  const fs=require('node:fs');
  const h=fs.readFileSync(path.join(__dirname,'../centurion-cc-regul.html'),'utf8');
  const saved=JSON.parse(h.match(/id="solutionDataComplete">([\s\S]*?)<\/script>/)[1]);
  const editor=editorSurface('regul',{saved}),model=E.make();model.state.rods.R=187;
  editor.receive({type:'centurion-editor-enable',enabled:true,signals:E.controlSignals(model)});
  editor.receive({type:'centurion-editor-tick',dt:0,signals:E.controlSignals(model)});
  const output=editor.messages.findLast(m=>m.type==='centurion-editor-outputs');
  assert.equal(output.outputs.posg,187);assert.ok(Number.isFinite(output.outputs.qchargeOut));
  assert.equal(output.outputs.qdecOut,undefined);assert.match(editor.get('regModeState').textContent,/QCHARGE/);
  assert.ok(editor.state().nodes.some(n=>n.type==='qdecSignal'));
});

test('éditeur complet : filtres de température actifs, TREF filtrée affichée et sauvegarde portable',()=>{
  const editor=editorSurface('regul',{saved:referenceModel('regul')}),model=E.make();
  let signals=E.controlSignals(model);
  editor.receive({type:'centurion-editor-enable',enabled:true,signals});
  editor.receive({type:'centurion-editor-tick',dt:0,signals});
  signals={...signals,ptur:[80,'% PN']};
  editor.receive({type:'centurion-editor-tick',dt:1,signals});
  const graph=editor.state();
  const tref=graph.nodes.find(n=>n.type==='filter'&&n.params.tau===60);
  assert.ok(tref);
  const expected=306.5+(1-Math.exp(-1/60))*(304.64-306.5);
  assert.ok(Math.abs(graph.signals.get(tref.id).value-expected)<1e-9);
  assert.equal(editor.get('regLiveLabel1').textContent,'TREF filtrée');
  assert.match(editor.get('regTref').textContent,/306,5/,'la valeur affichée vient du filtre');
  assert.equal(graph.nodes.filter(n=>n.type==='leadlag').length,1);
  assert.ok(graph.nodes.some(n=>n.params.curveRole==='rodSpeed'&&n.params.yUnit==='pas/min'));
  const saved={format:'SimuREP-Regulation',version:1,nodes:graph.nodes,links:graph.links,
    nodeCounter:100,viewport:{x:0,y:0,zoom:1}};
  const restored=editorSurface('regul',{saved}).state();
  assert.equal(restored.nodes.length,graph.nodes.length,'aucun bloc ajouté à chaque rechargement');
  assert.equal(restored.links.length,graph.links.length);
  assert.equal(restored.nodes.find(n=>n.id===tref.id).params.tau,60);
  // Une chaîne volontairement effacée reste effacée, sans régulation cachée.
  const empty=editorSurface('regul',{saved:{...saved,nodes:[],links:[]}});
  empty.receive({type:'centurion-editor-enable',enabled:true,signals});
  empty.receive({type:'centurion-editor-tick',dt:1,signals});
  assert.equal(empty.messages.findLast(m=>m.type==='centurion-editor-outputs').outputs.posg,undefined);
});

test('autosauvegarde incompatible : conserver la récupération et ouvrir un exercice vide',()=>{
  const saved={format:'ancien-incompatible',version:1,nodes:[],links:[]};
  const editor=editorSurface('regul',{saved});
  const recovery=[...editor.storage.entries()].find(([key])=>key.includes('-recovery-'));
  assert.equal(recovery?.[1],JSON.stringify(saved),'la sauvegarde incompatible reste récupérable');
  const model=E.make(),signals=E.controlSignals(model);
  editor.receive({type:'centurion-editor-enable',enabled:true,signals});
  editor.receive({type:'centurion-editor-tick',dt:1,signals});
  const output=editor.messages.findLast(m=>m.type==='centurion-editor-outputs');
  assert.equal(Object.keys(output.outputs).length,0);
  assert.equal(editor.state().nodes.length,0);
  assert.equal(editor.state().links.length,0);
});

test('application complète : Pause fige la physique, reprise avance et Réinitialiser arrête',()=>{
  const page=application();page.click('runButton');
  for(let i=0;i<3;i++)page.frame();
  page.click('runButton');const pausedTime=page.snapshot.time;
  for(let i=0;i<4;i++)page.frame();
  assert.equal(page.snapshot.time,pausedTime);
  assert.equal(page.get('runIndicator').textContent,'EN PAUSE');
  page.click('runButton');for(let i=0;i<3;i++)page.frame();
  assert.ok(page.snapshot.time>pausedTime);
  page.click('resetButton');page.frame(200);
  assert.equal(page.snapshot.time,0);assert.equal(page.get('simClock').textContent,'00:00:00');
  assert.equal(page.get('runButton').textContent,'Démarrer');
});

test('cadence CC : mêmes états à ×1, ×20 et ×200, y compris avec des images irrégulières et les fichiers locaux',()=>{
  function run(speed,frames,synchronous,seconds=60){
    let model,count=0;const trace=[];
    const engine={...E,make(){return model=E.make();},step(m,dt){
      const state=E.step(m,dt);count++;
      if(count%50===0&&count<=seconds*10)trace.push([state.tavgC,state.powerPct,state.rods.R,
        state.pressureBar,state.gv[0].levelPct]);return state;}};
    const {page,flush}=connectedApplication({synchronous,engine,svgUpdates:false});
    page.click('toggleRegulationSynoptic');flush();
    page.get('simSpeed').value=String(speed);page.get('simSpeed').fire('change');
    page.get('demandInput').value='80';page.get('demandInput').fire('input');page.click('runButton');
    let image=0;
    while(count<seconds*10){assert.ok(image<20000,'la simulation doit progresser');
      page.frame(frames[image++%frames.length]);flush();}
    assert.equal(model.state.tripAt,null);assert.equal(model.state.endState,null);
    return {trace,model};
  }
  const reference=run(1,[100],true);
  for(const [speed,frames,sync] of [[20,[100],true],[200,[16,50,150],true],[200,[100],false]]){
    const result=run(speed,frames,sync);
    assert.equal(result.trace.length,reference.trace.length);
    result.trace.forEach((row,i)=>row.forEach((value,j)=>assert.ok(
      Math.abs(value-reference.trace[i][j])<1e-8,
      `×${speed}, ${sync?'synchrone':'messages locaux'} : écart à ${5*(i+1)} s, mesure ${j}`)));
  }
  // Vérifier aussi la stabilisation, et pas seulement l'égalité des trajectoires.
  const stable=run(200,[16,50,150],true,600).trace.slice(-12);
  const span=j=>Math.max(...stable.map(r=>r[j]))-Math.min(...stable.map(r=>r[j]));
  assert.ok(span(0)<.3,`TMOY : étendue ${span(0)} °C dans la dernière minute`);
  assert.ok(span(1)<.5,`PN : étendue ${span(1)} % dans la dernière minute`);
});

test('calcul hydraulique coûteux : rendre la main à Pause sans changer les sous-pas physiques',()=>{
  let page,count=0,model;
  const engine={...E,make:()=>model=E.make(),step(m,dt){
    count++;assert.equal(dt,.1);const state=E.step(m,dt);page.consumeCpu(12);return state;
  }};
  page=application(app,null,engine,{}, {svgUpdates:false});
  page.get('simSpeed').value='200';page.get('simSpeed').fire('change');page.click('runButton');
  page.frame(100);
  assert.equal(count,3,'le lot cède après 36 ms, avant les 150 pas possibles');
  assert.ok(Math.abs(model.state.time-.3)<1e-9);
  page.click('runButton');const paused=model.state.time;
  page.frame(100);assert.equal(model.state.time,paused,'Pause est prise en compte entre les lots');
  page.click('runButton');page.frame(100);assert.equal(count,6);
  assert.ok(Math.abs(model.state.time-.6)<1e-9);
});

test('CC par messages : attendre les réponses avant le pas suivant, Pause et Réinitialiser sans réponse périmée',()=>{
  let model;const {page,flush}=connectedApplication({svgUpdates:false,
    engine:{...E,make(){return model=E.make();}}});
  page.click('toggleRegulationSynoptic');flush();
  page.get('simSpeed').value='200';page.get('simSpeed').fire('change');page.click('runButton');
  page.frame(100);const waiting=model.state.time;
  assert.equal(waiting,.1,'un seul pas physique avant la réponse des deux CC');
  page.frame(100);assert.equal(model.state.time,waiting,'aucune avance avec des commandes anciennes');
  page.click('runButton');flush();assert.equal(model.state.time,waiting,'Pause fige la physique malgré les réponses');
  page.click('runButton');page.frame(100);
  page.click('resetButton');flush();assert.equal(model.state.time,0,'les réponses de la partie précédente sont ignorées');
  page.frame(200);assert.equal(model.state.time,0);
});
