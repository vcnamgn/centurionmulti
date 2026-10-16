const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const E=require('../centurion-engine.js');
const {svgSurface}=require('./helpers/svg-surface');
const liquidPoint=require('./helpers/liquid-primary-point');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../synoptiques/liaisons.json'),'utf8'));
const format=(v,d=0)=>Number(v).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const read=(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o);
const getBound=(surface,id)=>{const node=surface.get(id);return node.hasAttribute('data-value')?node:node.querySelector('[data-value]');};

function checkBindings(surface,snapshot,entry){
  surface.update(snapshot);
  for(const {id,value,decimals,template} of entry.bindings){
    const node=getBound(surface,id),actual=read(snapshot,value);
    assert.ok(node,`${entry.diagram}/${id} : liaison absente`);
    const number=actual===null?'—':format(actual,decimals);
    assert.equal(node.textContent,template.replaceAll('{value}',number).replaceAll('{gv}',String(snapshot.gv)),`${entry.diagram}/${id}`);
    assert.equal(node.getAttribute('data-current-value'),actual===null?'':String(actual),`${entry.diagram}/${id} : valeur sans arrondi`);
    assert.equal(node.getAttribute('data-available'),String(actual!==null));
  }
}

test('les 72 mesures ont une liaison explicite ; les sources locales disponibles restent intactes',()=>{
  assert.equal(manifest.reduce((n,m)=>n+m.bindings.length,0),72);
  const privateManifest=path.join(__dirname,'..','..','support','inventaires','liaisons-synoptiques.json');
  if(fs.existsSync(privateManifest)){
    for(const entry of JSON.parse(fs.readFileSync(privateManifest,'utf8'))){
      const source=fs.readFileSync(path.join(__dirname,'../..',entry.source));
      assert.equal(crypto.createHash('sha256').update(source).digest('hex'),entry.sourceSha256);
    }
  }
  for(const entry of manifest){
    const surface=svgSurface(entry.target);
    assert.equal(surface.root.getAttribute('data-centurion-diagram'),entry.diagram);
    assert.equal(surface.root.querySelectorAll('[data-value]').length,entry.bindings.length);
    assert.equal(surface.root.querySelectorAll('script')[0].getAttribute('href').split('?')[0],'../centurion-svg-bridge.js');
    assert.equal(surface.messages[0].type,'centurion-svg-ready');
  }
});

test('ensemble des mesures : initialisation, commande manuelle, évolution, AAR/IS et réinitialisation',()=>{
  const model=E.make();model.controls.protectionsEnabled=false;
  const surfaces=manifest.map(entry=>svgSurface(entry.target));
  const verify=()=>manifest.forEach((entry,i)=>{
    for(let gv=1;gv<=4;gv++)checkBindings(surfaces[i],E.instrumentSnapshot(model,gv),entry);
  });
  verify();
  Object.assign(model.controls,{rMode:'manual',rManualPas:190,manualHeaterKW:700,
    manualSprayPct:25,rcvChargeM3h:24,gvManualFeedPct:[38,42,47,53],
    manualReliefStages:[true,false,true],gctAOpeningPressureBar:55});
  E.advance(model,12);verify();
  const rcp=surfaces[0],pzr=surfaces[2],s=model.state;
  assert.equal(rcp.get('texte-17').textContent,format(s.rods.R));
  assert.equal(pzr.get('201KM-valeur').textContent,'25,0');
  assert.equal(pzr.get('004KM-valeur').textContent,'700');
  assert.equal(pzr.get('soupape-1-ouverture').textContent,'Étage 1 · 100 %');
  assert.equal(pzr.get('soupape-2-ouverture').textContent,'Étage 2 · 0 %');
  assert.equal(pzr.get('soupape-3-ouverture').textContent,'Étage 3 · 100 %');
  assert.equal(rcp.get('texte-193').textContent,'CHARGE RCV · 24,0 m³/h');
  assert.ok(s.gv.some(g=>g.dumpKgS>0),'le cas sollicite réellement GCT-A');
  // Isoler l'ordre IS : les soupapes de l'essai précédent sont refermées et
  // le point à 80 bar est sous-refroidi, sans provoquer de cavitation parasite.
  model.controls.manualReliefStages=[false,false,false];liquidPoint(E,model,80);
  E.initiate(model,'ris');E.initiate(model,'asg',{source:'cc-protect'});E.advance(model,80);verify();
  assert.ok(s.risDeliveredKgS>0,'injection parvenue au primaire');
  const displayed=Number(getBound(rcp,'ris-1-debit').getAttribute('data-current-value'));
  assert.ok(Math.abs(displayed-s.risDeliveredKgS*3.6/4)<1e-9,'RIS : conversion eau à 20 °C, pas eau primaire à chaud');
  assert.equal(rcp.get('texte-20').textContent,'—');
  assert.equal(rcp.get('gmpp-1').getAttribute('data-pump-state'),'running','IS laisse les GMPP en service');
  E.tripPrimaryPumps(model);verify();
  assert.equal(rcp.get('gmpp-1').getAttribute('data-pump-state'),'coasting','le déclenchement manuel avec inertie est animé');
  assert.ok(s.coreFlowKgS>0&&s.risCoreKgS>0,'le RIS contribue au débit cœur après désamorçage');
  for(let i=0;i<4;i++)if(s.inventory.loopPriming[i]===0)
    assert.equal(s.loops[i].naturalFlowKgS,0,'la boucle dénoyée ne conserve pas un thermosiphon fictif');
  assert.ok(surfaces[1].get('asg-debit').textContent!=='0,0','débit ASG après AAR');
  const reset=E.make();manifest.forEach((entry,i)=>checkBindings(surfaces[i],E.instrumentSnapshot(reset,1),entry));
  assert.equal(pzr.get('004KM-valeur').textContent,format(reset.state.heaterKW));
  assert.equal(rcp.get('gmpp-1').getAttribute('data-pump-state'),'running');
});

test('GV1 à GV4 puis retour : mesures et repères sélectionnés sans accumulation de renommages',()=>{
  const surface=svgSurface('synoptique-RCPGV-1300.svg'),model=E.make();
  for(const n of [1,2,3,4,1]){
    const g=model.state.gv[n-1];
    Object.assign(g,{steamValvePct:57.5,gctAValvePct:13.2,dumpKgS:25*n+.4,
      asgKgS:60*n,turbineSteamKgS:400+n,steamKgS:400+n+25*n+.4});
    surface.update(E.instrumentSnapshot(model,n));
    for(const [id,label] of [
      ['texte-19',`${n}04MP`],['texte-23',`${n}05MN`],['texte-27',`${n}06MN`],
      ['texte-28',`GCT-A${n}10VV`],['texte-29',`GCT-A${n}20VV`],['texte-33',`GCT-A${n}20KM`],
      ['texte-36',`VVP${n}20VV`],['texte-39',`VVP${n}40VV`],['texte-40',`VVP${n}41VV`],
      ['texte-44',`ASG${n}10VD`],['texte-45',`ASG${n}11VD`],
      ['texte-48',`ARE${n}30VL`],['texte-49',`ARE${n}40VL`],
      ['texte-53',`ASG${n}01MD`],['texte-57',`ARE${n}01MD`],['texte-61',`ARE${n}02MT`],
      ['texte-65',`VAP${n}`],['texte-69',`VPU${n}`],['texte-70',`BC${n}`],['texte-72',`BF${n}`]])
      assert.equal(surface.get(id).textContent,label,id);
    assert.equal(surface.get('texte-1').textContent,`GÉNÉRATEUR DE VAPEUR ${n}`);
    assert.equal(surface.get('texte-6').textContent,`GV ${n}`);
    assert.equal(surface.get('vvp-ouverture').textContent,`VVP${n}20KM · 57,5 %`);
    assert.equal(surface.get('gcta-debit').textContent,`${25*n},4`);
    assert.equal(surface.get('asg-debit').textContent,format(216*n,1));
    assert.equal(surface.get('vapeur-total').textContent,format(g.turbineSteamKgS+g.dumpKgS,1));
    assert.equal(surface.get('gcta-debit').getAttribute('data-flow-alarm'),'true');
    assert.equal(surface.get('gct-a-120-vv').getAttribute('data-opening-pct'),'13.2');
  }
  const reset=E.make();surface.update(E.instrumentSnapshot(reset));
  assert.equal(surface.get('gcta-debit').getAttribute('data-flow-alarm'),'false');
  assert.equal(surface.get('gct-a-120-vv').getAttribute('data-flow-alarm'),'false');
});

test('GV : eau, surface, jauges GL/GE cohérentes ; consigne NREF indépendante',()=>{
  const surface=svgSurface('synoptique-RCPGV-1300.svg'),m=E.make();
  m.controls.gvLevelSetpointPct=65;surface.update(E.instrumentSnapshot(m));
  const y=id=>Number(surface.get(id).getAttribute('y'));
  assert.ok(Math.abs(y('niveau-eau-gv')-y('jauge-gl-remplissage'))<1e-8);
  assert.ok(Math.abs(y('niveau-eau-gv')-y('jauge-ge-remplissage'))<1e-8);
  assert.match(surface.get('surface-eau-gv').getAttribute('d'),new RegExp(String(y('niveau-eau-gv'))));
  assert.equal(surface.get('105MN-valeur').textContent,'55,0');
  assert.equal(surface.get('106MN-valeur').textContent,'88,1');
  assert.equal(surface.get('texte-15').textContent,'NREF 65 % GE');
  const ref=surface.get('niveau-reference-gv').getAttribute('d');
  assert.ok(Number(/M737\s+([\d.]+)/.exec(ref)[1])<y('niveau-eau-gv'));
  Object.assign(m.state.gv[0],E.gvLevels(10*E.C.gvKgPerMetre));surface.update(E.instrumentSnapshot(m));
  assert.equal(Number(surface.get('jauge-ge-remplissage').getAttribute('height')),0);
  assert.ok(Number(surface.get('jauge-gl-remplissage').getAttribute('height'))>0);
  assert.ok(y('niveau-eau-gv')>Number(/M737\s+([\d.]+)/.exec(ref)[1]));
});

test('PZR : même niveau pour eau, surface et jauge ; NREF suit sa consigne propre',()=>{
  const surface=svgSurface('synoptique-RCPPZR-1300.svg'),m=E.make();
  for(const [level,ref] of [[0,20],[10,41.8],[80,35],[100,60]]){
    m.state.pzrLevelPct=level;m.state.nrefPct=ref;surface.update(E.instrumentSnapshot(m));
    const expectedY=965-535*level/100;
    assert.equal(Number(surface.get('niveau-eau-pzr').getAttribute('y')),expectedY);
    assert.equal(Number(surface.get('jauge-niveau-pzr-remplissage').getAttribute('y')),expectedY);
    assert.equal(surface.get('surface-eau-pzr').getAttribute('d'),`M728 ${expectedY}H992`);
    assert.equal(surface.get('niveau-reference-pzr').getAttribute('d'),`M728 ${965-535*ref/100}H992`);
    assert.equal(surface.get('texte-3').textContent,`NREF ${format(ref,1)} %`);
    assert.equal(Number(surface.get('texte-3').getAttribute('y')),965-535*ref/100-12);
    assert.equal(E.controlSignals(m).imchSignal[0],Math.min(100,level/15*100));
  }
});

test('renvois actifs : changement GV, retour au RCP, pressuriseur et grappes ; systèmes futurs désactivés',()=>{
  const rcp=svgSurface('synoptique-RCP-1300.svg');rcp.update(E.instrumentSnapshot(E.make()));
  for(const n of [1,2,3,4]){rcp.click(`renvoi-gv-${n}`);assert.equal(rcp.messages.at(-1).gv,n);}
  rcp.click('renvoi-pzr');assert.equal(rcp.messages.at(-1).diagram,'pzr');
  rcp.click('renvoi-grappes','Enter');assert.equal(rcp.messages.at(-1).diagram,'rods');
  const length=rcp.messages.length;
  for(const id of ['renvoi-charge-rcv','renvoi-rra-1','renvoi-ris-mp-2'])rcp.click(id);
  assert.equal(rcp.messages.length,length);
  const gv=svgSurface('synoptique-RCPGV-1300.svg');gv.update(E.instrumentSnapshot(E.make(),3));
  for(const [slot,n] of [[2,1],[3,2],[4,4]]){
    gv.click(`renvoi-gv-${slot}`);assert.equal(gv.messages.at(-1).gv,n);
  }
  gv.click('renvoi-bf1');assert.equal(gv.messages.at(-1).diagram,'rcp');assert.equal(gv.messages.at(-1).gv,3);
  assert.equal(gv.get('renvoi-gcta').getAttribute('aria-disabled'),'true');
});

test('le véritable envoi application publie les valeurs réalisées, même à l’arrêt de l’horloge',()=>{
  const model=E.make(),app=fs.readFileSync(path.join(__dirname,'../centurion-app.js'),'utf8');
  const sent=[];const surface=svgSurface('synoptique-RCP-1300.svg');
  const ctx=vm.createContext({E,model,diagram:'rcp',selectedGv:4,$:()=>({contentWindow:{postMessage:data=>{sent.push(data);surface.update(data);}}})});
  vm.runInContext(app.slice(app.indexOf('  function updateSvg()'),app.indexOf('  function renderBoard()'))+'globalThis.send=updateSvg;',ctx);
  ctx.send();assert.equal(surface.get('coeur-0-valeur').textContent,'100,0');
  model.state.powerPct=137.5;model.state.pressureBar=145.2;ctx.send();
  assert.equal(sent.at(-1).gv,4);assert.equal(surface.get('coeur-0-valeur').textContent,'137,5');
  assert.equal(surface.get('pression-pzr').textContent,'145,2');
});

test('synoptique des grappes conservé : toutes les positions restent animées après insertion et AAR',()=>{
  const surface=svgSurface('synoptique-RCPGRAPPES-1300.svg'),m=E.make();
  m.state.rods.R=170;surface.update(E.instrumentSnapshot(m));
  assert.equal(surface.get('position-R').textContent,'170');
  assert.equal(Number(surface.get('remplissage-R').getAttribute('height')),360*90/260);
  E.initiate(m,'trip');E.advance(m,5);surface.update(E.instrumentSnapshot(m));
  assert.equal(surface.get('position-R').textContent,'0');
  assert.equal(surface.get('compteur-g3').textContent,'—');
});
