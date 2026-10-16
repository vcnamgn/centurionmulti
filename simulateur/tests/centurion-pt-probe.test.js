const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../centurion-engine');
const State=require('../centurion-state'),H=require('../centurion-history');
const {svgSurface}=require('./helpers/svg-surface');
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);
const svgFile=path.resolve(__dirname,'../synoptiques/Diagramme-PT.svg');
const pointer=(surface,temperature,pressure)=>{
  const box=surface.root.getAttribute('viewBox').split(' ').map(Number);
  const r=surface.root.getBoundingClientRect(),scale=Math.min(r.width/box[2],r.height/box[3]);
  return {clientX:r.left+(r.width-box[2]*scale)/2+(105+temperature/370*1060-box[0])*scale,
    clientY:r.top+(r.height-box[3]*scale)/2+(710-pressure/180*610-box[1])*scale,buttons:0,button:0,pointerId:1};
};

test('SVG éditable : graduations tous les 10, grille au-dessus du domaine et limites visibles sans moteur',()=>{
  const svg=fs.readFileSync(svgFile,'utf8'),s=svgSurface('Diagramme-PT.svg');
  assert.equal(s.root.querySelectorAll('[data-grid-temperature]').length,38);
  assert.equal(s.root.querySelectorAll('[data-grid-pressure]').length,19);
  for(let t=0;t<=370;t+=10)assert.equal(s.get(`pt-tick-t-${t}`).textContent,String(t));
  for(let p=0;p<=180;p+=10)assert.equal(s.get(`pt-tick-p-${p}`).textContent,String(p));
  assert.ok(svg.indexOf('id="pt-layer-domain"')<svg.indexOf('id="pt-layer-grid"'));
  assert.equal((svg.match(/inkscape:groupmode="layer"/g)||[]).length,8);
  assert.match(s.get('pt-domain').getAttribute('d'),/^M.+ Z$/);
  assert.match(s.get('pt-saturation').getAttribute('d'),/^M.+ L/);
});

test('réticule : valeurs sur les deux axes, clic figé et mises à jour physiques indépendantes',()=>{
  const s=svgSurface('Diagramme-PT.svg'),point=pointer(s,168.5,31.2);
  s.fire('pointermove',point);
  assert.equal(s.get('pt-probe').getAttribute('visibility'),'visible');
  assert.equal(s.get('pt-probe-temperature-value').textContent,'168,5 °C');
  assert.equal(s.get('pt-probe-pressure-value').textContent,'31,2 bar');
  s.fire('click',point);assert.equal(s.root.getAttribute('data-pt-probe-locked'),'true');
  close(s.messages.at(-1).temperatureC,168.5);close(s.messages.at(-1).pressureBar,31.2);
  const line=s.get('pt-probe-vertical').getAttribute('d');
  s.fire('pointermove',pointer(s,300,155));s.fire('pointerleave');s.fire('click',pointer(s,200,60));
  s.update({...E.instrumentSnapshot(E.make()),ptHistory:[{tavg:306.5,pressure:155},{tavg:200,pressure:60}]});
  assert.equal(s.get('pt-probe-vertical').getAttribute('d'),line);
  assert.equal(s.get('pt-probe-temperature-value').textContent,'168,5 °C');
  assert.match(s.get('pt-trace').getAttribute('d'),/L/);
  close(Number(s.get('pt-point').getAttribute('cx')),105+306.5/370*1060);
});

test('Défiger : parent vérifié, reprise du survol, sortie du graphique et bords bornés',()=>{
  const s=svgSurface('Diagramme-PT.svg');s.fire('click',pointer(s,180,25));
  s.receive({type:'centurion-pt-probe-command',action:'release'},false);
  assert.equal(s.root.getAttribute('data-pt-probe-locked'),'true');
  s.receive({type:'centurion-pt-probe-command',action:'release'});
  assert.equal(s.root.getAttribute('data-pt-probe-locked'),'false');
  assert.equal(s.get('pt-probe').getAttribute('visibility'),'hidden');
  s.fire('pointermove',pointer(s,0,180));
  assert.equal(s.get('pt-probe-temperature-value').textContent,'0,0 °C');
  assert.equal(s.get('pt-probe-pressure-value').textContent,'180,0 bar');
  assert.equal(s.get('pt-probe-temperature').getAttribute('transform'),'translate(105 717)');
  assert.equal(s.get('pt-probe-pressure').getAttribute('transform'),'translate(8 100)');
  s.fire('pointermove',{clientX:0,clientY:0,buttons:0});
  assert.equal(s.get('pt-probe').getAttribute('visibility'),'hidden');
});

test('trois températures : points à la même pression, couleurs et absence de valeurs reconstruites',()=>{
  const surface=svgSurface('Diagramme-PT.svg'),snapshot=E.instrumentSnapshot(E.make());
  surface.update({...snapshot,ptHistory:[
    {tavg:300,hot:320,cold:280,pressure:155},
    {tavg:290,pressure:140}, // Ancien point sans mesures de branches : interrompre les courbes.
    {tavg:280,hot:300,cold:260,pressure:130}
  ]});
  for(const [suffix,key,color] of [['','tavgC','#299d69'],['-hot','hotC','#e7414d'],['-cold','coldC','#2685cc']]){
    const point=surface.get('pt-point'+suffix),trace=surface.get('pt-trace'+suffix);
    close(Number(point.getAttribute('cx')),105+snapshot[key]/370*1060);
    close(Number(point.getAttribute('cy')),710-snapshot.pressure/180*610);
    assert.equal(point.getAttribute('fill'),color);assert.equal(trace.getAttribute('stroke'),color);
    assert.doesNotMatch(trace.getAttribute('d'),/NaN|undefined/);
    if(suffix){assert.equal((trace.getAttribute('d').match(/M/g)||[]).length,2);assert.doesNotMatch(trace.getAttribute('d'),/L/);}
  }
  assert.match(surface.get('pt-value-hot').textContent,/TBC .* °C/);
  assert.match(surface.get('pt-value-cold').textContent,/TBF .* °C/);
  delete snapshot.hotC;surface.update(snapshot);
  assert.equal(surface.get('pt-point-hot').style.display,'none');
});

test('zoom et déplacement : coordonnées correctes après zoom, un glissement ne fige pas le réticule',()=>{
  const s=svgSurface('Diagramme-PT.svg');
  s.receive({type:'centurion-svg-viewport-command',action:'in'});
  const p=pointer(s,230,90);s.fire('pointermove',p);s.fire('click',p);
  assert.equal(s.get('pt-probe-temperature-value').textContent,'230,0 °C');
  assert.equal(s.get('pt-probe-pressure-value').textContent,'90,0 bar');
  s.receive({type:'centurion-pt-probe-command',action:'release'});
  s.fire('pointerdown',p);s.fire('pointermove',{...p,clientX:p.clientX+30,buttons:1});
  s.fire('pointerup',{...p,clientX:p.clientX+30});
  s.fire('click',{...p,clientX:p.clientX+30});
  assert.equal(s.root.getAttribute('data-pt-probe-locked'),'false');
  s.fire('click',pointer(s,250,70));
  assert.equal(s.get('pt-probe-temperature-value').textContent,'250,0 °C');
  assert.equal(s.get('pt-probe-pressure-value').textContent,'70,0 bar');
});

test('certificat : même grille 10/10 au-dessus du domaine, sans réticule de lecture',()=>{
  const s=svgSurface('Diagramme-PT.svg');s.fire('click',pointer(s,250,70));
  s.receive({type:'centurion-svg-capture-request',requestId:'pt-grid',snapshot:E.instrumentSnapshot(E.make())});
  const capture=s.messages.at(-1).svg;
  assert.match(capture,/<g[^>]*id="pt-probe"[^>]*visibility="hidden"/);
  const context=vm.createContext({module:{exports:{}},console});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../centurion-certificate.js'),'utf8'),context);
  const exported=context.module.exports.ptSvg(E.make(),E,{lower:[[10,5],[306.5,155]],upper:[[10,31],[306.5,155]],saturation:[]});
  assert.equal((exported.match(/data-grid-temperature=/g)||[]).length,38);
  assert.equal((exported.match(/data-grid-pressure=/g)||[]).length,19);
  assert.ok(exported.indexOf('fill="#e4f4ee"')<exported.indexOf('data-grid-temperature='));
  assert.doesNotMatch(exported,/id="pt-probe"/);
  for(const [suffix,color] of [['','#299d69'],['-hot','#e7414d'],['-cold','#2685cc']]){
    assert.match(exported,new RegExp(`id="pt-trace${suffix}"[^>]*stroke="${color}"`));
    assert.match(exported,new RegExp(`id="pt-point${suffix}"[^>]*fill="${color}"`));
  }
  assert.doesNotMatch(exported,/NaN|undefined/);
});

test('pupitre réel : état du bouton Défiger, source vérifiée, commande et libération à Réinitialiser',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../centurion.html'),'utf8');
  const app=fs.readFileSync(path.resolve(__dirname,'../centurion-app.js'),'utf8');
  const startup=fs.readFileSync(path.resolve(__dirname,'centurion-startup.test.js'),'utf8');
  const ctx=vm.createContext({E,H,State,app,html,vm,assert,svgSurface,Blob});
  vm.runInContext(startup.slice(startup.indexOf('function application('),startup.indexOf('\ntest('))
    +'globalThis.application=application;',ctx);
  const page=ctx.application();page.query('.diagram-tab[data-diagram="pt"]').click();
  assert.equal(page.get('ptTrailPicker').hidden,false);
  const data={type:'centurion-pt-probe',locked:true,temperatureC:168.5,pressureBar:31.2};
  page.receive(data,{});assert.equal(page.get('ptProbeRelease').disabled,true);
  page.receive(data,page.get('diagramObject').contentWindow);
  assert.equal(page.get('ptProbeRelease').disabled,false);
  assert.equal(page.get('ptProbeStatus').textContent,'Lecture figée · 168,5 °C · 31,2 bar');
  page.click('ptProbeRelease');assert.equal(page.get('ptProbeRelease').disabled,true);
  assert.equal(page.messages.at(-1).type,'centurion-pt-probe-command');
  assert.equal(page.messages.at(-1).action,'release');
  page.receive(data,page.get('diagramObject').contentWindow);page.click('resetButton');
  assert.equal(page.get('ptProbeRelease').disabled,true);
  assert.equal(page.get('ptProbeStatus').textContent,'Survoler · cliquer pour figer');
});

test('pupitre P–T : périodes conservées, trois traces et messages limités aux cinq mesures utiles',async()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../centurion.html'),'utf8');
  const app=fs.readFileSync(path.resolve(__dirname,'../centurion-app.js'),'utf8');
  const startup=fs.readFileSync(path.resolve(__dirname,'centurion-startup.test.js'),'utf8');
  const ctx=vm.createContext({E,H,State,app,html,vm,assert,svgSurface,Blob});
  vm.runInContext(startup.slice(startup.indexOf('function application('),startup.indexOf('\ntest('))
    +'globalThis.application=application;',ctx);
  const model=E.make(),point=E.historyPoint(model);model.state.time=28800;
  model.state.history=Array.from({length:28800},(_,i)=>({...point,t:i}));
  const page=ctx.application(app,null,{...E,make:()=>model});
  page.query('.diagram-tab[data-diagram="pt"]').click();
  for(const span of [300,1800,3600,14400]){
    page.get('ptTrailWindow').value=String(span);await page.get('ptTrailWindow').fire('change');
    const trail=page.snapshot.ptHistory;
    assert.ok(trail.length<=1201&&trail.length>1);
    assert.ok(trail[0].t>=model.state.time-span);
    for(const p of trail)assert.deepEqual(Array.from(Object.keys(p).sort()),['cold','hot','pressure','t','tavg']);
    const last=trail.at(-1);
    assert.equal(last.hot,model.state.hotC);assert.equal(last.cold,model.state.coldC);
    assert.equal(last.tavg,model.state.tavgC);assert.equal(last.pressure,model.state.pressureBar);
  }
  assert.equal(model.state.history.length,28800,'l’historique général reste complet');
  assert.ok(model.state.history[0].detail.length>100,'les mesures détaillées restent disponibles aux graphiques');
});
