const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../centurion-engine');
const Cert=require('../centurion-certificate');
const {svgSurface}=require('./helpers/svg-surface');
const {certificateCaptureSurface}=require('./helpers/certificate-capture-surface');

test('certificat : seuls les scénarios terminés, nom visible, durée et deux verdicts',()=>{
  const m=E.make();assert.throws(()=>Cert.certificateSummary(m,'Alice'),/fin du scénario/);
  m.state.time=14765.8;m.state.endState='safe';m.state.endReason='RRA connecté';
  const good=Cert.certificateSummary(m,'  Élodie <Artiste>  ');
  assert.equal(good.artist,'Élodie <Artiste>');assert.equal(good.duration,'04:06:05');
  assert.equal(good.stamp,'VALIDÉ');assert.match(good.filename,/^Centurion-safe-Elodie-Artiste-\.png$/);
  m.state.endState='melted';const bad=Cert.certificateSummary(m,'');
  assert.equal(bad.artist,'Anonyme');assert.equal(bad.stamp,'ÉCHEC FATAL');assert.equal(bad.safe,false);
});

test('certificat : P–T sur quatre heures, données réelles, point courant et mémoire bornée',()=>{
  const m=E.make();m.state.time=20000;m.state.tavgC=167;m.state.hotC=169;m.state.coldC=165;m.state.pressureBar=28;
  m.state.history=Array.from({length:20001},(_,t)=>({t,tavg:306-t/200,hot:325-t/200,cold:287-t/200,pressure:155-t/150}));
  const trail=Cert.ptTrail(m);
  assert.equal(trail[0].t,5600);assert.ok(trail.length<=1201);
  assert.deepEqual(trail.at(-1),{t:20000,tavg:167,hot:169,cold:165,pressure:28});
  assert.deepEqual(trail[1],{t:5613,tavg:m.state.history[5613].tavg,hot:m.state.history[5613].hot,
    cold:m.state.history[5613].cold,pressure:m.state.history[5613].pressure});
});

test('certificat : archives gelées aux événements, AAR PLIN et fin ; réinitialisation sans traces anciennes',()=>{
  const m=E.make(),archive=Cert.createArchive(E);archive.observe(m);
  const initial=archive.getRecords()[0];const initialMass=initial.snapshot.primaryMassKg;
  m.state.time=60;m.state.peakLinearWcm=455;m.state.signals.highLinearPower=true;
  m.state.tripDemandAt=60;archive.observe(m);
  m.state.time=80;m.state.risDemandAt=80;m.state.primaryMassKg*=.8;archive.observe(m);
  m.state.time=90;m.state.reliefKgS=25;archive.observe(m);
  m.state.time=100;m.state.coreDamageWarning={reason:'Dénoyage'};archive.observe(m);
  m.state.time=105;m.state.endState='melted';archive.observe(m);
  for(let i=0;i<30;i++){m.state.time++;m.state.primaryMassKg*=.8;archive.observe(m);}
  const records=archive.getRecords();assert.ok(records.length<=7);
  const aar=records.find(r=>r.key==='aar');assert.equal(aar.diagram,'core');
  assert.equal(aar.core.peak,455);assert.equal(aar.time,60);
  m.state.axialShape32.fill(0);m.state.inventory.levelM=-10;m.state.pressureBar=0;
  assert.equal(archive.getRecords()[0].snapshot.primaryMassKg,initialMass);
  assert.equal(archive.getRecords().find(r=>r.key==='aar').core.shape[0],aar.core.shape[0]);
  assert.ok(archive.getRecords()[0].snapshot.inventory.levelM>0);
  assert.equal(records.find(r=>r.key==='final').time,105);
  assert.match(Cert.coreSvg(aar,E),/PLIN max 455 W\/cm/);
  const clean=E.make();archive.observe(clean);
  assert.deepEqual(archive.getRecords().map(r=>r.key),['initial']);
});

test('certificat : un AAR hors PLIN conserve le pressuriseur',()=>{
  const m=E.make(),archive=Cert.createArchive(E);archive.observe(m);
  E.initiate(m,'trip');archive.observe(m);
  assert.equal(archive.getRecords().find(r=>r.key==='aar').diagram,'pzr');
});

test('certificat : capture des SVG par le bridge réel, valeurs synchronisées et scripts retirés',()=>{
  const model=E.make();model.state.pressureBar=29;model.state.tavgC=168;
  for(const file of ['Diagramme-PT.svg','CPP-inventaire.svg','synoptique-RCPPZR-1300.svg']){
    const surface=svgSurface(file),initial=surface.messages.length;
    if(file.includes('RCPPZR')){
      const metadata=surface.root.querySelectorAll('*').find(n=>n.qualifiedName==='cc:Work');
      assert.ok(metadata,'le vrai SVG contient une métadonnée étrangère');
      assert.equal(metadata.style,undefined,'les métadonnées étrangères au SVG ne possèdent pas de style');
    }
    const request={type:'centurion-svg-capture-request',requestId:'essai',snapshot:{...E.instrumentSnapshot(model),ptHistory:Cert.ptTrail(model)}};
    surface.receive(request,false);assert.equal(surface.messages.length,initial,'seul le parent peut demander une capture');
    surface.receive(request);const result=surface.messages.at(-1);
    assert.equal(result.type,'centurion-svg-capture-result');assert.equal(result.requestId,'essai');
    assert.doesNotMatch(result.svg,/<script\b/);assert.match(result.svg,/<svg\b/);
    assert.match(result.svg,/29,0/,'la pression du moteur figure dans l’image');
    assert.equal(surface.root.querySelectorAll('script').length,1,'la capture ne retire pas le script de la vue vivante');
  }
});

test('certificat : captures répétées depuis le cache, bridge tardif et notification ready manquée',async()=>{
  const surface=certificateCaptureSurface();
  for(let round=1;round<=3;round++){
    const model=E.make();model.state.time=round*60;model.state.pressureBar=30-round;
    const pending=surface.api.captureSvg('synoptiques/Diagramme-PT.svg',E.instrumentSnapshot(model));
    const frame=surface.frames.at(-1);assert.equal(frame.tag,'iframe');
    assert.equal(frame.requests.length,1,'load arrive avant le bridge');
    surface.retry();assert.equal(frame.requests.length,2,'la première relance reste sans réponse');
    frame.ready=true;surface.retry();
    const svg=await pending;
    assert.match(svg,new RegExp(`${30-round},0`),'valeur de la nouvelle partie');
    assert.match(svg,new RegExp(`data-simulation-time="${round*60}"`));
    assert.doesNotMatch(svg,/<script\b/);
    assert.equal(frame.eventCount,0);
    assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
  }
});

test('certificat : ancienne réponse et autre fenêtre ne peuvent pas terminer la capture suivante',async()=>{
  const surface=certificateCaptureSurface(),snapshot=E.instrumentSnapshot(E.make());
  const first=surface.api.captureSvg('synoptiques/CPP-inventaire.svg',snapshot);
  const oldFrame=surface.frames.at(-1);oldFrame.ready=true;surface.retry();await first;
  const second=surface.api.captureSvg('synoptiques/CPP-inventaire.svg',snapshot);
  const frame=surface.frames.at(-1),id=frame.requests[0].requestId;
  surface.emit(oldFrame.contentWindow,{type:'centurion-svg-capture-result',requestId:id,svg:'ancienne partie'});
  surface.emit(frame.contentWindow,{type:'centurion-svg-capture-result',requestId:oldFrame.requests[0].requestId,svg:'ancien identifiant'});
  assert.equal(frame.removed,false,'aucune des deux fausses réponses n’est acceptée');
  frame.ready=true;surface.retry();assert.match(await second,/<svg\b/);
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
});

test('certificat : réinitialisation annule une capture, libère les ressources puis autorise une nouvelle',async()=>{
  const surface=certificateCaptureSurface(),controller=new AbortController(),snapshot=E.instrumentSnapshot(E.make());
  const pending=surface.api.captureSvg('synoptiques/CPP-inventaire.svg',snapshot,controller.signal);
  const cancelled=assert.rejects(pending,/réinitialisation/);
  controller.abort();await cancelled;
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
  const next=surface.api.captureSvg('synoptiques/CPP-inventaire.svg',snapshot);
  surface.frames.at(-1).ready=true;surface.retry();assert.match(await next,/<svg\b/);
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
});

test('certificat : délai dépassé nettoyé, nouvelle tentative possible',async()=>{
  const surface=certificateCaptureSurface(),snapshot=E.instrumentSnapshot(E.make());
  const pending=surface.api.captureSvg('synoptiques/Diagramme-PT.svg',snapshot);
  const expired=assert.rejects(pending,/n’a pas répondu/);surface.expire();await expired;
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
  const next=surface.api.captureSvg('synoptiques/Diagramme-PT.svg',snapshot);
  surface.frames.at(-1).ready=true;surface.retry();assert.match(await next,/<svg\b/);
});

test('certificat : ancienne génération annulée ne déverrouille pas les commandes de la suivante',async()=>{
  const surface=certificateCaptureSurface();let model=E.make();model.state.endState='safe';
  const certificate=surface.api.create({E,getModel:()=>model,svgFiles:{pt:'synoptiques/Diagramme-PT.svg',inventory:'synoptiques/CPP-inventaire.svg'},ptCurves:{lower:[],upper:[],saturation:[]},prepare(){}});
  certificate.observe(model);
  const first=surface.get('certificateGenerate').fire('click');
  assert.equal(surface.get('certificateGenerate').disabled,true);
  surface.get('certificatePreview').setAttribute('src','ancienne image');
  model=E.make();certificate.observe(model);
  assert.equal(surface.get('certificatePreview').hidden,true);
  assert.equal(surface.get('certificatePreview').getAttribute('src'),undefined);
  assert.equal(surface.get('certificateDownload').disabled,true);
  assert.equal(surface.get('certificatePrint').disabled,true);
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
  model.state.endState='safe';certificate.observe(model);
  const second=surface.get('certificateGenerate').fire('click');
  await first;
  assert.equal(surface.get('certificateGenerate').disabled,true,'la fin de la première tâche ne déverrouille pas la deuxième');
  assert.equal(surface.get('certificateArtist').disabled,true);
  assert.doesNotMatch(surface.get('certificateStatus').textContent,/Création impossible/);
  model=E.make();certificate.observe(model);await second;
  assert.equal(surface.get('certificateGenerate').disabled,false);
  assert.equal(surface.get('certificateArtist').disabled,false);
  assert.deepEqual(surface.pending,{listeners:0,timeouts:0,intervals:0,frames:0});
});
