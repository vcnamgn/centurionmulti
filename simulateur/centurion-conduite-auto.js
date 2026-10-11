(function(){
  'use strict';
  const A=window.CenturionAuto,R=window.CenturionAutoRouting,$=id=>document.getElementById(id),STORAGE='centurion.conduite-auto.v1';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const fmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:3}):'—';
  const ruleFmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumSignificantDigits:3}):'—';
  let graph=A.emptyGraph(),runtime=A.idle(),measurements=[],values={},commands=A.actionCatalog(),connected=false,simulationRunning=false;
  let selected=null,pending=null,drag=null,undo=[],view={x:0,y:0,w:1200,h:700},suppressClick=false;
  let sequenceListSignature=null,runtimeDrawingSignature=null,seenSerial=0;
  const recent=new Map();let routesSignature=null;const routes=new Map();
  const locked=()=>['running','paused'].includes(runtime.status);
  const post=data=>parent.postMessage(data,'*');
  const current=()=>graph.nodes.find(n=>n.id===selected);
  const id=prefix=>prefix+'-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const known=()=>new Set(measurements.map(d=>d.id));
  function status(message,error=false){$('editStatus').textContent=message;$('editStatus').dataset.error=String(error);}
  function persist(){
    try{localStorage.setItem(STORAGE,JSON.stringify(graph));}catch(_){status('Le stockage du navigateur est indisponible. Utilisez Enregistrer sous…',true);}
    post({type:'centurion-auto-graph',graph});
  }
  function edit(fn,redrawProperties=true){
    if(locked())return false;const before=JSON.stringify(graph);
    try{fn();graph=A.validate(graph,measurements.length?known():null);
      undo.push(before);if(undo.length>50)undo.shift();persist();draw();refreshSequences();
      if(redrawProperties)properties();status('Diagramme enregistré dans ce navigateur.');return true;
    }catch(error){graph=JSON.parse(before);status(error.message,true);return false;}
  }
  const dimensions=R.dimensions,portPoint=R.portPoint;
  function subtitle(n){
    const p=n.params,m=measurements.find(m=>m.id===p.variable),c=commands.find(c=>c.id===p.command);
    if(n.type==='test')return [m?.label||p.variable,`${p.operator} ${fmt(p.value)} ${m?.unit||''} · tol. ${fmt(p.tolerance)}`];
    if(n.type==='ranges')return [m?.label||p.variable,`${p.labels.length} plages · ${m?.unit||''}`];
    if(n.type==='action')return [c?.label||p.command,c?.options?.find(([v])=>v===p.value)?.[1]||`${fmt(p.value)} ${c?.unit||''}`];
    if(n.type==='wait')return [`${fmt(p.duration)} ${{seconds:'secondes',minutes:'minutes',hours:'heures'}[p.unit]}`];
    if(n.type==='info')return [p.message];
    if(n.type==='parallel')return [`${p.branches} branches indépendantes`,'Clôture obligatoire'];
    if(n.type==='join'){
      const groups=(runtime.groups||[]).filter(g=>g.join===n.id);
      return [groups.length?groups.map(g=>`${g.arrived.length}/${g.expected} branches terminées`).join(' · '):'Réunit tous les curseurs','Reprise après la dernière branche'];
    }
    return [n.type==='start'?'Point de départ de la séquence':'Termine la séquence'];
  }
  function short(value,max=33){return value.length>max?value.slice(0,max-1)+'…':value;}
  function rangeDrawing(n){
    const p=n.params,{w,barY,markers}=R.ruleLayout(n),span=p.scale.max-p.scale.min;
    const segments=A.ruleSegments(p).map((r,i)=>{
      const x=n.x+14+(w-28)*(r.min-p.scale.min)/span,rw=(w-28)*(r.max-r.min)/span;
      return `<rect class="range-segment" x="${x}" y="${n.y+barY}" width="${rw}" height="24" fill="${['#cde6f0','#cfead7','#f2d9b5','#e2d3ed'][i%4]}"/>`
        +(rw>=19?`<text class="range-label" text-anchor="middle" x="${x+rw/2}" y="${n.y+barY+16}">P${i+1}</text>`:'')
        +`<text class="range-label" text-anchor="middle" x="${n.x+w*(i+1)/(p.labels.length+1)}" y="${n.y+barY+61}">P${i+1}</text>`;
    }).join('');
    return segments+markers.map(({index,x,lane})=>{
      const cy=n.y+barY-16-lane*22,value=p.separators[index];
      return `<g class="range-marker" data-range-boundary="${index}" role="slider" tabindex="0" aria-label="Repère ${index+1}" aria-valuenow="${value}" aria-valuemin="${index?p.separators[index-1]:p.scale.min}" aria-valuemax="${index<p.separators.length-1?p.separators[index+1]:p.scale.max}"><title>Repère ${index+1} : ${esc(ruleFmt(value))}</title><line class="range-divider-hit" x1="${n.x+x}" x2="${n.x+x}" y1="${cy}" y2="${n.y+barY+25}"/><line class="range-divider" x1="${n.x+x}" x2="${n.x+x}" y1="${cy+8}" y2="${n.y+barY+25}"/><circle cx="${n.x+x}" cy="${cy}" r="8"/><text text-anchor="middle" x="${n.x+x}" y="${cy+3.5}">${index+1}</text></g>`;
    }).join('')+`<text class="range-scale" x="${n.x+14}" y="${n.y+barY+42}">${esc(ruleFmt(p.scale.min))}</text><text class="range-scale" text-anchor="end" x="${n.x+w-14}" y="${n.y+barY+42}">${esc(ruleFmt(p.scale.max))}</text>`;
  }
  function draw(){
    $('canvas').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
    $('zoomValue').textContent=Math.round(1200/view.w*100)+' %';
    $('emptyHint').hidden=Boolean(graph.nodes.length);
    const routeSignature=JSON.stringify(graph.nodes.map(n=>[n.id,n.x,n.y,n.type,n.params.scale,n.params.separators,n.params.labels,n.params.branches]));
    if(routeSignature!==routesSignature){routes.clear();routesSignature=routeSignature;}
    const portMarkup=[];
    $('boxes').innerHTML=graph.nodes.map(n=>{
      const {w,h}=dimensions(n),p=n.params,color={start:['#e6f5ed','#72b095'],end:['#e6f5ed','#72b095'],test:['#fff4df','#d7a861'],ranges:['#fff4df','#d7a861'],
        action:['#f1e9f7','#af87c3'],parallel:['#f1e9f7','#af87c3'],join:['#f1e9f7','#af87c3'],info:['#e7f2fd','#87b7d8'],wait:['#ebf1f6','#9db2c4']}[n.type];
      const active=(runtime.activeNodes||[runtime.current]).includes(n.id)&&['running','paused','error'].includes(runtime.status);
      const highlighted=!active&&recent.has(n.id);
      const port=(kind,incoming=false)=>{
        const point=portPoint(n,kind),label=incoming?'Entrée':kind==='yes'?'Vrai':kind.startsWith('no-')?'Faux':kind.startsWith('range:')?'Plage '+(Number(kind.split(':')[1])+1)+' · '+p.labels[Number(kind.split(':')[1])]:kind.startsWith('branch:')?'Branche '+(Number(kind.split(':')[1])+1):'Suite';
        return `<circle class="port ${pending?.node===n.id&&pending?.port===kind?'pending':''}" cx="${point.x}" cy="${point.y}" r="6" ${incoming?'data-input':'data-output'}="${esc(n.id)}" data-port="${kind}" role="button" tabindex="0" aria-label="${esc(n.name+' · '+label)}"><title>${esc(label)}</title></circle>`;
      };
      const range=n.type==='ranges'?rangeDrawing(n):'';
      portMarkup.push((n.type!=='start'?port('in',true):'')+A.ports(n).map(p=>port(p)).join(''));
      return `<g class="box ${highlighted?'recent':''} ${selected===n.id?'selected':''} ${active?(runtime.status==='error'?'failed':'executing'):''}" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.name)}">
        <title>${esc(n.name)}</title><rect class="body" x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="${n.type==='start'||n.type==='end'?20:8}" fill="${color[0]}" stroke="${color[1]}"/>
        <text class="title" x="${n.x+12}" y="${n.y+24}">${esc(short(n.name,29))}</text>
        ${(runtime.tokens||[]).filter(t=>t.current===n.id).length>1?`<text class="cursor-count" text-anchor="end" x="${n.x+w-10}" y="${n.y+h-12}">${(runtime.tokens||[]).filter(t=>t.current===n.id).length} curseurs</text>`:''}
        ${subtitle(n).map((t,i)=>`<text class="detail" x="${n.x+12}" y="${n.y+47+i*17}">${esc(short(t))}</text>`).join('')}${range}
        ${n.type==='test'?`<text class="port-label" x="${n.x+w/2+10}" y="${n.y+h-8}">Vrai</text><text class="port-label" x="${n.x+10}" y="${n.y+h/2-7}">Faux</text><text class="port-label" text-anchor="end" x="${n.x+w-10}" y="${n.y+h/2-7}">Faux</text>`:''}
      </g>`;
    }).join('');
    $('ports').innerHTML=portMarkup.join('');
    let blocked=0;
    $('links').innerHTML=graph.links.map(l=>{
      const a=graph.nodes.find(n=>n.id===l.from),b=graph.nodes.find(n=>n.id===l.to);if(!a||!b)return '';
      const cacheKey=l.from+'/'+l.port+'/'+l.to;
      if(!routes.has(cacheKey))routes.set(cacheKey,R.route(graph,l));
      const route=routes.get(cacheKey),d=R.path(route.points);if(route.blocked)blocked++;
      return `<g data-link="${esc(l.id)}" role="button" tabindex="0" aria-label="Liaison ${esc(a.name+' vers '+b.name)}"><title>${route.blocked?'Tracé impossible : écartez les boîtes.':'Connecteur à angle droit'}</title><path class="edge ${route.blocked?'blocked':''} ${selected===l.id?'selected':''}" d="${d}"/><path class="edge-hit" d="${d}"/></g>`;
    }).join('');
    $('routeWarning').textContent=blocked?`${blocked} liaison(s) sans passage libre : écartez les boîtes.`:'';
    $('delete').disabled=locked()||!selected;$('duplicate').disabled=locked()||!current()||current()?.type==='join';$('undo').disabled=locked()||!undo.length;
  }
  function select(value){
    const focused=document.activeElement;
    if(focused?.matches('[data-rule-boundary],[data-rule-scale]')&&focused.closest('#properties')&&!commitRuleField(focused))return false;
    selected=value;draw();properties();return true;
  }
  function refreshSequences(){
    const previous=$('sequenceSelect').value,list=A.sequences(graph);
    const signature=JSON.stringify(list);
    if(signature!==sequenceListSignature){
      $('sequenceSelect').innerHTML=list.length?list.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''):'<option value="">Créer une boîte Départ</option>';
      if(list.some(s=>s.id===previous))$('sequenceSelect').value=previous;
      sequenceListSignature=signature;
    }
    $('startSequence').disabled=!connected||locked()||!list.length;
  }
  function options(list,value){return list.map(([v,t])=>`<option value="${esc(JSON.stringify(v))}"${v===value?' selected':''}>${esc(t)}</option>`).join('');}
  function picker(list,value,field,label,index=''){
    return `<label>Rechercher ${label}<input type="search" data-search="${field}" data-index="${index}" placeholder="Nom, repère ou unité…" aria-label="Rechercher ${label}"></label>
      <label>${label}<select data-field="${field}" data-index="${index}" aria-label="${esc(label)}">${list.map(d=>`<option value="${esc(d.id)}"${d.id===value?' selected':''}>${esc((d.tag?d.tag+' · ':'')+d.label+(d.unit?' · '+d.unit:''))}</option>`).join('')}</select></label>`;
  }
  function actionFields(p,index=''){
    const c=commands.find(c=>c.id===p.command);
    return picker(commands,p.command,'command','une action',index)+`<label>Valeur ${esc(c?.unit||'')}${c?.options
      ?`<select data-field="value" data-index="${index}" data-option-value="true">${options(c.options,p.value)}</select>`
      :`<input data-field="value" data-index="${index}" type="number" min="${c?.min??0}" max="${c?.max??100}" step="any" value="${p.value}">`}</label>`;
  }
  function waitFields(p,index=''){
    return `<div class="row"><label>Durée<input data-field="duration" data-index="${index}" type="number" min="0" step="any" value="${p.duration}"></label><label>Unité<select data-field="unit" data-index="${index}">${Object.entries({seconds:'Secondes',minutes:'Minutes',hours:'Heures'}).map(([v,t])=>`<option value="${v}"${p.unit===v?' selected':''}>${t}</option>`).join('')}</select></label></div>`;
  }
  function properties(){
    const n=current();
    if(!n){$('properties').innerHTML=graph.links.some(l=>l.id===selected)?'<h2>Liaison</h2><p>Supprimer retire cette liaison, sans effacer les boîtes.</p>':'<h2>Propriétés</h2><p>Sélectionnez une boîte ou une liaison.</p>';return;}
    const p=n.params;
    let content=`<h2>${esc({start:'Départ',test:'Comparaison',ranges:'Règle à plages',action:'Action',info:'Information',wait:'Attente',parallel:'Effectuer les X actions en parallèle',join:'Attendre la fin de toutes les actions simultanées',end:'Fin'}[n.type])}</h2><label>Nom<input data-name="true" maxlength="100" value="${esc(n.name)}"></label>`;
    content+=`<label>Durée minimale de cette étape<select data-field="stepDelayS" data-option-value="true">${options([[null,'Réglage commun ('+graph.stepDelayS+' s simulées)'],...A.STEP_DELAYS.map(v=>[v,v+' s simulées'])],p.stepDelayS??null)}</select></label>`;
    if(['test','ranges'].includes(n.type)){
      content+=picker(measurements,p.variable,'variable','une mesure')+'<p class="reading" id="selectedReading"></p>';
      if(n.type==='test')content+=`<div class="row"><label>Test<select data-field="operator">${A.OPERATORS.map(v=>`<option${v===p.operator?' selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Seuil<input type="number" step="any" data-field="value" value="${p.value}"></label></div>`;
      if(n.type==='test')content+=`<label>Tolérance (unité de la mesure)<input type="number" min="0" step="any" data-field="tolerance" value="${p.tolerance}"></label>`;
      if(n.type==='ranges'){
        const step=A.ruleStep(p.scale),unit=measurements.find(m=>m.id===p.variable)?.unit||'';
        content+=`<h3>Échelle de la règle ${esc(unit)}</h3><div class="row"><label>Minimum affiché<input type="number" step="${step}" data-rule-scale="min" value="${p.scale.min}"></label><label>Maximum affiché<input type="number" step="${step}" data-rule-scale="max" value="${p.scale.max}"></label></div><button id="defaultRuleScale" class="remove-row">Échelle par défaut de la mesure</button><h3>Repères de séparation</h3>`;
        content+=p.separators.map((value,i)=>`<div class="separator-row"><span class="separator-number">${i+1}</span><label>Repère ${i+1} ${esc(unit)}<input type="number" step="${step}" data-rule-boundary="${i}" value="${value}" aria-label="Valeur du repère ${i+1}"></label><button class="remove-row" data-remove-boundary="${i}" aria-label="Retirer le repère ${i+1}">×</button></div>`).join('');
        content+=`<button id="addRange"${p.labels.length>=8?' disabled':''}>Ajouter un repère</button><p>Les repères sont communs aux deux plages voisines. Saisie validée par Entrée ou en quittant le champ ; la molette agit immédiatement. Retirer un repère conserve la liaison de la plage de gauche.</p><h3>Plages et sorties basses</h3>`;
        content+=p.labels.map((label,i)=>`<div class="range-row"><label>Plage ${i+1}<input data-range="${i}" value="${esc(label)}" maxlength="60"></label><span data-range-summary="${i}">${esc(rangeSummary(p,i))}</span></div>`).join('');
        content+='<p>La première et la dernière plage incluent les valeurs hors de l’échelle affichée. Aucun trou ni sortie latérale.</p>';
      }
    }else if(n.type==='action')content+=actionFields(p);
    else if(n.type==='wait')content+=waitFields(p);
    else if(n.type==='info')content+=`<label>Texte<textarea data-field="message" maxlength="2000">${esc(p.message)}</textarea></label>`;
    else if(n.type==='parallel'){
      content+=`<label>Nombre de branches<select data-field="branches" data-option-value="true">${options(Array.from({length:7},(_,i)=>[i+2,String(i+2)]),p.branches)}</select></label><p>Chaque sortie basse lance un curseur indépendant. Reliez toutes les branches à la clôture associée.</p><p>Clôture : <strong>${esc(graph.nodes.find(b=>b.id===p.join)?.name||'absente')}</strong></p>`;
    }else if(n.type==='join')content+='<p>Cette boîte attend tous les curseurs lancés par son ouverture. Une seule suite repart ensuite. Supprimez l’ouverture pour retirer sa clôture.</p>';
    content+='<p class="property-note">Les changements sont appliqués dès la saisie. Pour modifier une conduite active, interrompez-la.</p>';
    $('properties').innerHTML=content;setEditingLock();updateReading();
  }
  function rangeSummary(p,i){return i===0&&p.labels.length===1?'Toutes les valeurs':i===0?'Inférieur à '+ruleFmt(p.separators[0]):i===p.labels.length-1?'À partir de '+ruleFmt(p.separators.at(-1)):ruleFmt(p.separators[i-1])+' inclus → '+ruleFmt(p.separators[i])+' exclu';}
  function commitRuleField(el){
    const n=current();if(n?.type!=='ranges'||locked())return false;
    if(el.value.trim()===''||!Number.isFinite(Number(el.value))){el.setAttribute('aria-invalid','true');status('Saisissez une valeur numérique pour ce repère ou cette échelle.',true);return false;}
    const value=Number(el.value),ok=edit(()=>{
      if(el.dataset.ruleBoundary!==undefined)A.setRuleSeparator(n.params,Number(el.dataset.ruleBoundary),value);
      else A.setRuleScale(n.params,{...n.params.scale,[el.dataset.ruleScale]:value});
    },false);
    el.setAttribute('aria-invalid',String(!ok));
    if(ok){const p=current().params;
      for(const summary of $('properties').querySelectorAll('[data-range-summary]'))summary.textContent=rangeSummary(p,Number(summary.dataset.rangeSummary));
      for(const input of $('properties').querySelectorAll('[data-rule-boundary],[data-rule-scale]'))input.setAttribute('step',A.ruleStep(p.scale));
    }
    return ok;
  }
  function updateReading(){const n=current(),m=measurements.find(m=>m.id===n?.params.variable);
    if($('selectedReading'))$('selectedReading').textContent=`Valeur actuelle : ${fmt(values[n.params.variable])} ${m?.unit||''}`;}
  function setEditingLock(){
    for(const el of document.querySelectorAll('#properties input,#properties select,#properties textarea,#properties button,.library button'))el.disabled=locked();
    for(const id of ['graphName','stepDelay','openGraph','clearGraph'])$(id).disabled=locked();
    if($('addRange'))$('addRange').disabled=locked()||current()?.params.labels.length>=8;
  }
  function refreshRuntime(){
    const active=runtime.status==='running',paused=runtime.status==='paused';
    const now=performance.now();
    if(runtime.eventSerial<seenSerial){recent.clear();seenSerial=0;}
    for(const e of runtime.history||[])if((e.serial||0)>seenSerial&&e.event==='entrée')recent.set(e.node,now+2000);
    seenSerial=runtime.eventSerial||0;
    for(const [id,expires] of recent)if(expires<=now)recent.delete(id);
    $('stepDelay').value=String(graph.stepDelayS);
    $('runStatus').textContent=runtime.message+(active&&!simulationRunning?' · simulation en pause':'')
      +(active&&runtime.remaining>0?' · '+fmt(runtime.remaining)+' s simulées restantes':'');
    $('runStatus').dataset.error=String(runtime.status==='error');
    $('pauseSequence').disabled=!active;$('resumeSequence').disabled=!paused;$('stopSequence').disabled=!active&&!paused;
    $('runLog').innerHTML=runtime.history.slice(-25).map(h=>`<li>${fmt(h.time)} s · ${esc(h.name)} : ${esc(h.event)}</li>`).join('');
    setEditingLock();refreshSequences();
    const drawing=runtime.status+' / '+(runtime.activeNodes||[runtime.current]).join(',')+' / '+[...recent.keys()].join(',')+' / '+JSON.stringify((runtime.groups||[]).map(g=>[g.id,g.arrived]));
    if(drawing!==runtimeDrawingSignature){runtimeDrawingSignature=drawing;draw();}
    updateReading();
  }
  function receive(data){
    if(data?.type==='centurion-auto-init'){
      try{graph=A.validate(data.graph,new Set(data.measurements.map(d=>d.id)));measurements=data.measurements;commands=data.commands;
        runtime=data.runtime;values=data.values||{};connected=true;simulationRunning=data.simulationRunning;
        $('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);pending=null;undo=[];
        if(!graph.nodes.some(n=>n.id===selected))selected=null;
        try{localStorage.setItem(STORAGE,JSON.stringify(graph));}catch(_error){}
        draw();properties();refreshRuntime();
      }catch(error){status(error.message,true);}return;
    }
    if(data?.type==='centurion-auto-state'){
      runtime=data.runtime;values=data.values;simulationRunning=data.simulationRunning;refreshRuntime();return;
    }
    if(data?.type==='centurion-auto-error')status(data.message,true);
    if(data?.type==='centurion-auto-connect')return {type:'centurion-auto-ready',graph};
  }
  function eventField(e){
    const el=e.target,n=current();if(!n||locked())return;
    if(el.dataset.search!==undefined){
      const list=el.dataset.search==='command'?commands:measurements,words=norm(el.value).trim().split(/\s+/).filter(Boolean);
      const select=$('properties').querySelector(`select[data-field="${el.dataset.search}"][data-index="${el.dataset.index||''}"]`);
      if(!select)return;const chosen=select.value;
      select.innerHTML=list.filter(d=>d.id===chosen||words.every(w=>norm(d.id+' '+d.label+' '+d.tag+' '+d.unit).includes(w)))
        .map(d=>`<option value="${esc(d.id)}">${esc((d.tag?d.tag+' · ':'')+d.label+(d.unit?' · '+d.unit:''))}</option>`).join('');
      select.value=chosen;return;
    }
    if(el.dataset.name){if(el.value.trim())edit(()=>{n.name=el.value;},false);return;}
    if(el.dataset.range!==undefined){
      edit(()=>{n.params.labels[Number(el.dataset.range)]=el.value;},false);return;
    }
    const field=el.dataset.field;if(!field)return;
    const p=n.params;
    const value=el.dataset.optionValue?JSON.parse(el.value):el.type==='number'?Number(el.value):el.value;
    if(el.type==='number'&&el.value==='')return;
    edit(()=>{p[field]=value;
      if(field==='variable'&&n.type==='ranges')A.setRuleScale(p,A.ruleScale(measurements.find(m=>m.id===value)),true);
      if(field==='command'){const c=commands.find(c=>c.id===value);p.value=c.options?c.options[0][0]:c.min;}
      if(field==='branches')graph.links=graph.links.filter(l=>!(l.from===n.id&&l.port.startsWith('branch:')&&Number(l.port.split(':')[1])>=value));
    },field==='command'||field==='variable'||field==='branches');
  }
  function coordinate(e){const p=$('canvas').createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform($('canvas').getScreenCTM().inverse());}
  function fit(){
    if(!graph.nodes.length)view={x:0,y:0,w:1200,h:700};
    else {const left=Math.min(...graph.nodes.map(n=>n.x))-60,top=Math.min(...graph.nodes.map(n=>n.y))-60;
      const right=Math.max(...graph.nodes.map(n=>n.x+dimensions(n).w))+60,bottom=Math.max(...graph.nodes.map(n=>n.y+dimensions(n).h))+60;
      const aspect=$('canvas').clientWidth/$('canvas').clientHeight,w=Math.max(500,right-left,(bottom-top)*aspect),h=w/aspect;
      view={x:left-(w-(right-left))/2,y:top-(h-(bottom-top))/2,w,h};}
    draw();
  }
  function zoom(factor){const w=Math.max(250,Math.min(10000,view.w*factor)),h=view.h*w/view.w;
    view={x:view.x+(view.w-w)/2,y:view.y+(view.h-h)/2,w,h};draw();}
  function connectInput(target){
    if(!pending||locked())return;
    edit(()=>{
      graph.links=graph.links.filter(l=>!(l.from===pending.node&&l.port===pending.port));
      const from=graph.nodes.find(n=>n.id===pending.node);
      if(from.type==='test'&&pending.port.startsWith('no-'))graph.links=graph.links.filter(l=>!(l.from===from.id&&l.port.startsWith('no-')));
      graph.links.push({id:id('link'),from:pending.node,port:pending.port,to:target});
    });pending=null;draw();
  }
  function canvasClick(e){
    if(suppressClick){suppressClick=false;return;}
    const out=e.target.closest('[data-output]'),input=e.target.closest('[data-input]');
    if(out&&!locked()){pending={node:out.dataset.output,port:out.dataset.port};draw();status('Cliquez l’entrée haute de la boîte suivante.');return;}
    if(input){connectInput(input.dataset.input);return;}
    const n=e.target.closest('[data-node]'),l=e.target.closest('[data-link]');select(n?.dataset.node||l?.dataset.link||null);
    if(!n&&!l){pending=null;draw();}
  }
  function remove(){
    if(!selected||locked())return;if(current()?.type==='join'){status('La clôture est obligatoire. Supprimez son ouverture pour la retirer.',true);return;}
    const removed=new Set([selected,...(current()?.type==='parallel'?[current().params.join]:[])]);edit(()=>{graph.nodes=graph.nodes.filter(n=>!removed.has(n.id));
      graph.links=graph.links.filter(l=>l.id!==selected&&!removed.has(l.from)&&!removed.has(l.to));});selected=null;draw();properties();
  }
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
    const n=A.node(b.dataset.add,id('box'),view.x+70+(graph.nodes.length%3)*260,view.y+65+Math.floor(graph.nodes.length/3)*160);
    if(n.type==='start'){let i=1;while(graph.nodes.some(b=>b.type==='start'&&b.name===n.name))n.name='Séquence '+ ++i;}
    if(edit(()=>{graph.nodes.push(n);if(n.type==='parallel'){const j=A.node('join',id('join'),n.x,n.y+320);j.params.fork=n.id;n.params.join=j.id;graph.nodes.push(j);}}))select(n.id);
  }));
  $('properties').addEventListener('input',e=>{if(e.target.localName!=='select')eventField(e);});
  $('properties').addEventListener('change',e=>{if(e.target.matches('[data-rule-boundary],[data-rule-scale]'))commitRuleField(e.target);else if(e.target.localName==='select')eventField(e);});
  $('properties').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-rule-boundary],[data-rule-scale]')){e.preventDefault();commitRuleField(e.target);}});
  $('properties').addEventListener('click',e=>{
    const n=current();if(!n||locked())return;
    if(e.target.id==='addRange')edit(()=>A.splitRule(graph,n));
    if(e.target.dataset.removeBoundary!==undefined)edit(()=>A.removeRuleSeparator(graph,n,Number(e.target.dataset.removeBoundary)));
    if(e.target.id==='defaultRuleScale')edit(()=>A.setRuleScale(n.params,A.ruleScale(measurements.find(m=>m.id===n.params.variable)),true));
  });
  $('stepDelay').addEventListener('change',e=>edit(()=>{graph.stepDelayS=Number(e.target.value);}));
  $('graphName').addEventListener('input',e=>edit(()=>{graph.name=e.target.value;},false));
  $('canvas').addEventListener('click',canvasClick);
  $('canvas').addEventListener('keydown',e=>{
    const marker=e.target.closest('[data-range-boundary]');
    if(marker&&['ArrowLeft','ArrowRight'].includes(e.key)&&!locked()){
      e.preventDefault();const n=graph.nodes.find(n=>n.id===marker.closest('[data-node]').dataset.node),index=Number(marker.dataset.rangeBoundary);
      edit(()=>A.setRuleSeparator(n.params,index,A.roundRuleValue(n.params.separators[index]+(e.key==='ArrowRight'?1:-1)*A.ruleStep(n.params.scale))));return;
    }
    if(e.key==='Escape'){pending=null;draw();return;}
    if(e.key==='Delete'){e.preventDefault();remove();return;}
    if(e.code==='Space'){e.preventDefault();fit();return;}
    if(e.key==='Enter')canvasClick(e);
  });
  $('canvas').addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('[data-output],[data-input]'))return;
    const point=coordinate(e),n=graph.nodes.find(n=>n.id===e.target.closest('[data-node]')?.dataset.node);
    const boundary=e.target.closest('[data-range-boundary]');
    if(n){if(!select(n.id))return;if(locked())return;drag={node:n.id,x:point.x,y:point.y,bx:n.x,by:n.y,before:JSON.stringify(graph),moved:false,
      ...(boundary?{boundary:Number(boundary.dataset.rangeBoundary)}:{})};}
    else if(!e.target.closest('[data-link]'))drag={x:point.x,y:point.y,beforeView:{...view},moved:false};
    $('canvas').setPointerCapture(e.pointerId);
  });
  $('canvas').addEventListener('pointermove',e=>{
    if(!drag)return;const p=coordinate(e),dx=p.x-drag.x,dy=p.y-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;
    if(drag.node){const n=graph.nodes.find(n=>n.id===drag.node);
      if(drag.boundary!==undefined){
        const params=n.params,i=drag.boundary,span=params.scale.max-params.scale.min;
        const low=i?params.separators[i-1]:params.scale.min,high=i<params.separators.length-1?params.separators[i+1]:params.scale.max;
        const value=A.roundRuleValue(params.scale.min+(p.x-n.x-14)/(dimensions(n).w-28)*span);
        if(value>low&&value<high)params.separators[i]=value;
      }else{n.x=Math.max(-19000,Math.min(19000,drag.bx+dx));n.y=Math.max(-19000,Math.min(19000,drag.by+dy));}
    }
    else {view.x-=dx;view.y-=dy;}
    draw();
  });
  function finishDrag(){
    if(!drag)return;suppressClick=drag.moved;
    if(drag.node&&drag.moved){undo.push(drag.before);if(undo.length>50)undo.shift();persist();}
    const resized=drag.boundary!==undefined;drag=null;draw();if(resized)properties();
  }
  $('canvas').addEventListener('pointerup',finishDrag);$('canvas').addEventListener('pointercancel',finishDrag);
  $('canvas').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();zoom(e.deltaY>0?1.15:1/1.15);},{passive:false});
  $('properties').addEventListener('wheel',e=>{
    const el=e.target;if(el.type!=='number'||el.disabled||!e.deltaY)return;
    e.preventDefault();const step=el.dataset.field==='tolerance'?.01:Number(el.step)>0?Number(el.step):1;
    const rule=el.matches('[data-rule-boundary],[data-rule-scale]'),value=Number(el.value)+(e.deltaY<0?step:-step);
    el.value=rule?A.roundRuleValue(value):Math.max(el.min===''?-Infinity:Number(el.min),Math.min(el.max===''?Infinity:Number(el.max),value));
    if(rule)commitRuleField(el);else eventField({target:el});
  },{passive:false});
  $('fit').addEventListener('click',fit);$('zoomIn').addEventListener('click',()=>zoom(1/1.2));$('zoomOut').addEventListener('click',()=>zoom(1.2));
  $('delete').addEventListener('click',remove);
  $('duplicate').addEventListener('click',()=>{const n=cloneNode(current());if(!n)return;
    n.id=id('box');n.x+=40;n.y+=130;n.name=short(n.name,85)+' · copie';
    while(graph.nodes.some(b=>b.type==='start'&&b.name===n.name))n.name+='2';
    if(edit(()=>{graph.nodes.push(n);if(n.type==='parallel'){const j=A.node('join',id('join'),n.x,n.y+320);j.params.fork=n.id;n.params.join=j.id;graph.nodes.push(j);}}))select(n.id);
  });
  function cloneNode(n){return n?JSON.parse(JSON.stringify(n)):null;}
  $('undo').addEventListener('click',()=>{
    if(locked()||!undo.length)return;graph=JSON.parse(undo.pop());selected=null;pending=null;$('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);persist();draw();properties();refreshSequences();
  });
  $('clearGraph').addEventListener('click',()=>{if(locked())return;
    if(graph.nodes.length&&!confirm('Créer un diagramme vide ? La dernière modification pourra être annulée.'))return;
    edit(()=>{graph=A.emptyGraph();});$('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);selected=null;properties();
  });
  $('saveGraph').addEventListener('click',()=>{
    try{const valid=A.validate(graph,measurements.length?known():null),url=URL.createObjectURL(new Blob([JSON.stringify(valid,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=(graph.name.replace(/[^\wÀ-ÿ-]/g,'-')||'conduite')+'.centurion-conduite.json';
      a.hidden=true;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Diagramme exporté.');
    }catch(error){status(error.message,true);}
  });
  $('openGraph').addEventListener('click',()=>$('graphFile').click());
  $('graphFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file||locked())return;
    try{if(file.size>2e6)throw Error('Fichier trop volumineux (2 Mo maximum).');
      const loaded=A.validate(await file.text(),measurements.length?known():null);
      if(graph.nodes.length&&!confirm('Remplacer le diagramme courant par ce fichier ?'))return;
      if(edit(()=>{graph=loaded;})){selected=null;pending=null;$('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);properties();fit();status('Conduite chargée · aucune séquence lancée.');}
    }catch(error){status('Ouverture impossible : '+error.message,true);}finally{e.target.value='';}
  });
  for(const [button,action] of [['startSequence','start'],['pauseSequence','pause'],['resumeSequence','resume'],['stopSequence','stop']])
    $(button).addEventListener('click',()=>post({type:'centurion-auto-command',action,sequence:$('sequenceSelect').value}));
  window.addEventListener('message',e=>{if(e.source===parent)receive(e.data);});
  window.CenturionAutoEditor={receive};
  try{const saved=localStorage.getItem(STORAGE);if(saved)graph=A.validate(saved);}catch(error){status('Conduite locale non chargée : '+error.message,true);}
  $('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);draw();properties();refreshSequences();
  setInterval(()=>{if(recent.size)refreshRuntime();},100);
  post({type:'centurion-auto-ready',graph});
})();
