(function(){
  'use strict';
  const A=window.CenturionAuto,R=window.CenturionAutoRouting,B=window.CenturionAutoEditing,$=id=>document.getElementById(id),STORAGE='centurion.conduite-auto.v1';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const fmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:3}):'—';
  const ruleFmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumSignificantDigits:3}):'—';
  let graph=A.emptyGraph(),runtime=A.idle(),measurements=[],values={},commands=A.actionCatalog(),connected=false,simulationRunning=false;
  let selected=null,selection=new Set(),pending=null,drag=null,undo=[],redo=[],clipboard=null,importGraph=null,view={x:0,y:0,w:1200,h:700},suppressClick=false;
  let sequenceListSignature=null,runtimeDrawingSignature=null,seenSerial=0;
  const recent=new Map();let routesSignature=null;const routes=new Map();
  const locked=()=>['running','paused'].includes(runtime.status);
  const post=data=>parent.postMessage(data,'*');
  const current=()=>selection.size<=1?graph.nodes.find(n=>n.id===selected):null;
  const id=prefix=>prefix+'-'+(window.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const known=()=>new Set(measurements.map(d=>d.id));
  function status(message,error=false){$('editStatus').textContent=message;$('editStatus').dataset.error=String(error);}
  function persist(){
    try{localStorage.setItem(STORAGE,JSON.stringify(graph));}catch(_){status('Le stockage du navigateur est indisponible. Utilisez Enregistrer sous…',true);}
    post({type:'centurion-auto-graph',graph});
  }
  const snapshot=()=>({graph:JSON.stringify(graph),selected,selection:[...selection],view:{...view}});
  function remember(before){undo.push(before);if(undo.length>50)undo.shift();redo=[];}
  function syncDocument(){
    selection=new Set([...selection].filter(id=>graph.nodes.some(n=>n.id===id)));
    if(!graph.nodes.some(n=>n.id===selected)&&!graph.links.some(l=>l.id===selected))selected=null;
    $('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);
    persist();draw();properties();refreshSequences();
  }
  function history(backward){
    const source=backward?undo:redo,destination=backward?redo:undo;
    if(locked()||!source.length)return;
    destination.push(snapshot());const saved=source.pop();graph=JSON.parse(saved.graph);
    selected=saved.selected;selection=new Set(saved.selection);view={...saved.view};pending=null;
    syncDocument();status(backward?'Modification annulée.':'Modification rétablie.');
  }
  function edit(fn,redrawProperties=true){
    if(locked())return false;const before=snapshot();
    try{fn();graph=A.validate(graph,measurements.length?known():null);
      if(JSON.stringify(graph)!==before.graph)remember(before);persist();draw();refreshSequences();
      if(redrawProperties)properties();status('Diagramme enregistré dans ce navigateur.');return true;
    }catch(error){graph=JSON.parse(before.graph);view=before.view;status(error.message,true);return false;}
  }
  const textCanvas=document.createElement('canvas').getContext('2d');
  R.configure({measureText:(text,size,bold)=>{textCanvas.font=`${bold?'700':'400'} ${size}px "Segoe UI",Arial,sans-serif`;return textCanvas.measureText(text).width;}});
  const subtitle=n=>R.instructions(n,runtime),dimensions=n=>R.dimensions(n,subtitle(n)),portPoint=(n,port)=>R.portPoint(n,port,dimensions);
  function short(value,max=33){return value.length>max?value.slice(0,max-1)+'…':value;}
  function rangeDrawing(n){
    const p=n.params,{w,barY,markers}=R.ruleLayout(n,subtitle(n)),span=p.scale.max-p.scale.min;
    const segments=A.ruleSegments(p).map((r,i)=>{
      const x=n.x+14+(w-28)*(r.min-p.scale.min)/span,rw=(w-28)*(r.max-r.min)/span;
      return `<rect class="range-segment" x="${x}" y="${n.y+barY}" width="${rw}" height="24" fill="${['#cde6f0','#cfead7','#f2d9b5','#e2d3ed'][i%4]}"/>`
        +(rw>=19?`<text class="range-label" text-anchor="middle" x="${x+rw/2}" y="${n.y+barY+16}">P${i+1}</text>`:'')
        +`<text class="range-label" text-anchor="middle" x="${n.x+w*(i+1)/(p.labels.length+1)}" y="${n.y+barY+61}">P${i+1}</text>`;
    }).join('');
    return segments+markers.map(({index,x,labelX,lane})=>{
      const cy=n.y+barY-18-lane*36,value=p.separators[index];
      return `<g class="range-marker" data-range-boundary="${index}" role="slider" tabindex="0" aria-label="Repère ${index+1}" aria-valuenow="${value}" aria-valuemin="${index?p.separators[index-1]:p.scale.min}" aria-valuemax="${index<p.separators.length-1?p.separators[index+1]:p.scale.max}"><title>Repère ${index+1} : ${esc(ruleFmt(value))}</title><line class="range-divider-hit" x1="${n.x+x}" x2="${n.x+x}" y1="${cy-20}" y2="${n.y+barY+25}"/><line class="range-divider" x1="${n.x+x}" x2="${n.x+x}" y1="${cy+8}" y2="${n.y+barY+25}"/><text class="range-value" text-anchor="middle" x="${n.x+labelX}" y="${cy-18}">${esc(ruleFmt(value))}</text><circle cx="${n.x+x}" cy="${cy}" r="9"/><text text-anchor="middle" x="${n.x+x}" y="${cy+4}">${index+1}</text></g>`;
    }).join('')+`<text class="range-scale" x="${n.x+14}" y="${n.y+barY+42}">${esc(ruleFmt(p.scale.min))}</text><text class="range-scale" text-anchor="end" x="${n.x+w-14}" y="${n.y+barY+42}">${esc(ruleFmt(p.scale.max))}</text>`;
  }
  function draw(){
    $('canvas').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
    $('zoomValue').textContent=Math.round(1200/view.w*100)+' %';
    $('emptyHint').hidden=Boolean(graph.nodes.length);
    const routeSignature=JSON.stringify(graph.nodes.map(n=>[n.id,n.x,n.y,n.type,n.params,dimensions(n).w,dimensions(n).h]));
    if(routeSignature!==routesSignature){routes.clear();routesSignature=routeSignature;}
    const portMarkup=[];
    $('boxes').innerHTML=graph.nodes.map(n=>{
      const {w,h,headerHeight,titleLines,bodyLines}=dimensions(n),p=n.params,color={start:['#e6f5ed','#72b095'],end:['#e6f5ed','#72b095'],test:['#fff4df','#d7a861'],ranges:['#fff4df','#d7a861'],
        action:['#f1e9f7','#af87c3'],parallel:['#f1e9f7','#af87c3'],join:['#f1e9f7','#af87c3'],info:['#e7f2fd','#87b7d8'],wait:['#ebf1f6','#9db2c4']}[n.type];
      const active=(runtime.activeNodes||[runtime.current]).includes(n.id)&&['running','paused','error'].includes(runtime.status);
      const highlighted=!active&&recent.has(n.id);
      const port=(kind,incoming=false)=>{
        const point=portPoint(n,kind),label=incoming?'Entrée':kind==='yes'?'Vrai':kind.startsWith('no-')?'Faux':kind.startsWith('range:')?'Plage '+(Number(kind.split(':')[1])+1)+' · '+p.labels[Number(kind.split(':')[1])]:kind.startsWith('branch:')?'Branche '+(Number(kind.split(':')[1])+1):'Suite';
        return `<circle class="port ${pending?.node===n.id&&pending?.port===kind?'pending':''}" cx="${point.x}" cy="${point.y}" r="6" ${incoming?'data-input':'data-output'}="${esc(n.id)}" data-port="${kind}" role="button" tabindex="0" aria-label="${esc(n.name+' · '+label)}"><title>${esc(label)}</title></circle>`;
      };
      const range=n.type==='ranges'?rangeDrawing(n):'';
      const radius=n.type==='start'||n.type==='end'?20:8;
      portMarkup.push((n.type!=='start'?port('in',true):'')+A.ports(n).map(p=>port(p)).join(''));
      return `<g class="box ${highlighted?'recent':''} ${selection.has(n.id)?'selected':''} ${active?(runtime.status==='error'?'failed':'executing'):''}" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.name)}" aria-pressed="${selection.has(n.id)}">
        <title>${esc(n.name+'\n'+subtitle(n).join('\n'))}</title><rect class="body" x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="${radius}" fill="${color[0]}" stroke="${color[1]}"/>
        <path class="name-band" d="M${n.x+radius} ${n.y}H${n.x+w-radius}Q${n.x+w} ${n.y} ${n.x+w} ${n.y+radius}V${n.y+headerHeight}H${n.x}V${n.y+radius}Q${n.x} ${n.y} ${n.x+radius} ${n.y}Z" fill="${color[1]}35"/>
        <line class="band-divider" x1="${n.x}" x2="${n.x+w}" y1="${n.y+headerHeight}" y2="${n.y+headerHeight}" stroke="${color[1]}"/>
        ${titleLines.map((t,i)=>`<text class="title" x="${n.x+14}" y="${n.y+25+i*20}">${esc(t)}</text>`).join('')}
        ${(runtime.tokens||[]).filter(t=>t.current===n.id).length>1?`<text class="cursor-count" text-anchor="end" x="${n.x+w-10}" y="${n.y+h-12}">${(runtime.tokens||[]).filter(t=>t.current===n.id).length} curseurs</text>`:''}
        ${bodyLines.map((t,i)=>`<text class="detail" x="${n.x+14}" y="${n.y+headerHeight+25+i*21}">${esc(t)}</text>`).join('')}${range}
        ${n.type==='test'?`<text class="port-label" x="${n.x+w/2+10}" y="${n.y+h-8}">Vrai</text><text class="port-label" x="${n.x+10}" y="${n.y+h-37}">Faux</text><text class="port-label" text-anchor="end" x="${n.x+w-10}" y="${n.y+h-37}">Faux</text>`:''}
      </g>`;
    }).join('');
    $('ports').innerHTML=portMarkup.join('');
    let blocked=0;
    $('links').innerHTML=graph.links.map(l=>{
      const a=graph.nodes.find(n=>n.id===l.from),b=graph.nodes.find(n=>n.id===l.to);if(!a||!b)return '';
      const cacheKey=l.from+'/'+l.port+'/'+l.to;
      if(!routes.has(cacheKey))routes.set(cacheKey,R.route(graph,l,dimensions));
      const route=routes.get(cacheKey),d=R.path(route.points);if(route.blocked)blocked++;
      return `<g data-link="${esc(l.id)}" role="button" tabindex="0" aria-label="Liaison ${esc(a.name+' vers '+b.name)}"><title>${route.blocked?'Tracé impossible : écartez les boîtes.':'Connecteur à angle droit'}</title><path class="edge ${route.blocked?'blocked':''} ${selected===l.id?'selected':''}" d="${d}"/><path class="edge-hit" d="${d}"/></g>`;
    }).join('');
    $('routeWarning').textContent=blocked?`${blocked} liaison(s) sans passage libre : écartez les boîtes.`:'';
    $('delete').disabled=locked()||!selected;$('duplicate').disabled=locked()||!selection.size;
    $('copy').disabled=!selection.size;$('paste').disabled=locked()||!clipboard?.nodes.length;
    $('undo').disabled=locked()||!undo.length;$('redo').disabled=locked()||!redo.length;
    $('selectionOverlay').innerHTML=drag?.marquee?`<rect class="selection-rectangle" x="${drag.rectangle.x}" y="${drag.rectangle.y}" width="${drag.rectangle.w}" height="${drag.rectangle.h}"/>`:'';
  }
  function select(value,additive=false){
    const focused=document.activeElement;
    if(focused?.matches('[data-rule-boundary],[data-rule-scale]')&&focused.closest('#properties')&&!commitRuleField(focused))return false;
    if(graph.nodes.some(n=>n.id===value)){
      if(additive){if(selection.has(value))selection.delete(value);else selection.add(value);}
      else selection=new Set([value]);
      selected=selection.has(value)?value:[...selection].at(-1)||null;
    }else {if(!additive)selection.clear();selected=value||[...selection].at(-1)||null;}
    draw();properties();return true;
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
  function pickerOptions(list,value,field){
    const option=d=>`<option value="${esc(d.id)}"${d.id===value?' selected':''}>${esc((d.tag?d.tag+' · ':'')+d.label+(d.unit?' · '+d.unit:''))}</option>`;
    if(field!=='command')return list.map(option).join('');
    const groups=new Map();for(const d of list){const group=d.group||'Autres';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(d);}
    return [...groups].map(([label,items])=>`<optgroup label="${esc(label)}">${items.map(option).join('')}</optgroup>`).join('');
  }
  function picker(list,value,field,label,index=''){
    return `<label>Rechercher ${label}<input type="search" data-search="${field}" data-index="${index}" placeholder="Nom, repère ou unité…" aria-label="Rechercher ${label}"></label>
      <label>${label}<select data-field="${field}" data-index="${index}" aria-label="${esc(label)}">${pickerOptions(list,value,field)}</select></label>`;
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
    if(selection.size>1){$('properties').innerHTML=`<h2>${selection.size} boîtes sélectionnées</h2><p>Glissez une boîte sélectionnée pour déplacer l’ensemble. Copier, Dupliquer ou Supprimer s’applique à la sélection.</p><p>Shift + clic ajoute ou retire une boîte. L’ouverture et la clôture parallèles sont conservées ensemble lors d’une copie ou d’une suppression.</p>`;return;}
    const n=current();
    if(!n){$('properties').innerHTML=graph.links.some(l=>l.id===selected)?'<h2>Liaison</h2><p>Supprimer retire cette liaison, sans effacer les boîtes.</p>':'<h2>Propriétés</h2><p>Sélectionnez une boîte ou une liaison.</p>';return;}
    const p=n.params;
    let content=`<h2>${esc({start:'Départ',test:'Comparaison',ranges:'Règle à plages',action:'Action',info:'Information',wait:'Attente',parallel:'Plusieurs actions',join:'Attendre la fin de toutes les actions simultanées',end:'Fin'}[n.type])}</h2><label>Nom<input data-name="true" maxlength="100" value="${esc(n.name)}"></label>`;
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
    }else if(n.type==='action'){
      const items=A.actionItems(p);
      content+=items.map((a,i)=>`<section class="action-row"><div class="action-row-head"><strong>Action ${i+1}</strong><span>
        ${i?`<button data-move-action="${i}" data-direction="-1" aria-label="Monter l’action ${i+1}">↑</button>`:''}
        ${i<items.length-1?`<button data-move-action="${i}" data-direction="1" aria-label="Descendre l’action ${i+1}">↓</button>`:''}
        ${items.length>1?`<button data-remove-action="${i}" aria-label="Retirer l’action ${i+1}">×</button>`:''}</span></div>${actionFields(a,String(i))}</section>`).join('');
      content+=`<button id="addAction"${items.length>=24?' disabled':''}>Ajouter une action</button><p>Les actions s’appliquent une seule fois à l’entrée, dans l’ordre affiché. Placez les changements de mode avant les commandes qui en dépendent.</p>`;
    }
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
    if(locked()&&$('importDialog').hasAttribute('open')){$('importDialog').close();importGraph=null;}
    if($('addRange'))$('addRange').disabled=locked()||current()?.params.labels.length>=8;
    if($('addAction'))$('addAction').disabled=locked()||A.actionItems(current().params).length>=24;
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
        R.configure({measurements,commands});routesSignature=null;
        runtime=data.runtime;values=data.values||{};connected=true;simulationRunning=data.simulationRunning;
        $('graphName').value=graph.name;$('stepDelay').value=String(graph.stepDelayS);pending=null;undo=[];redo=[];
        if(!graph.nodes.some(n=>n.id===selected))selected=null;
        selection=new Set([...selection].filter(id=>graph.nodes.some(n=>n.id===id)));
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
      select.innerHTML=pickerOptions(list.filter(d=>d.id===chosen||words.every(w=>norm(d.id+' '+d.label+' '+d.tag+' '+d.unit+' '+d.group).includes(w))),chosen,el.dataset.search);
      select.value=chosen;return;
    }
    if(el.dataset.name){if(el.value.trim())edit(()=>{n.name=el.value;},false);return;}
    if(el.dataset.range!==undefined){
      edit(()=>{n.params.labels[Number(el.dataset.range)]=el.value;},false);return;
    }
    const field=el.dataset.field;if(!field)return;
    const p=n.type==='action'&&el.dataset.index!==undefined&&el.dataset.index!==''?(n.params.actions?.[Number(el.dataset.index)]||n.params):n.params;
    const value=el.dataset.optionValue?JSON.parse(el.value):el.type==='number'?Number(el.value):el.value;
    if(el.type==='number'&&el.value==='')return;
    const ok=edit(()=>{p[field]=value;
      if(field==='variable'&&n.type==='ranges')A.setRuleScale(p,A.ruleScale(measurements.find(m=>m.id===value)),true);
      if(field==='command'){const c=commands.find(c=>c.id===value);p.value=c.options?c.options[0][0]:c.min;}
      if(field==='branches')graph.links=graph.links.filter(l=>!(l.from===n.id&&l.port.startsWith('branch:')&&Number(l.port.split(':')[1])>=value));
    },field==='command'||field==='variable'||field==='branches');
    if(!ok&&field==='command')properties();
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
    if(suppressClick){suppressClick=false;if(e.type==='click')return;}
    const out=e.target.closest('[data-output]'),input=e.target.closest('[data-input]');
    if(out&&!locked()){pending={node:out.dataset.output,port:out.dataset.port};draw();status('Cliquez l’entrée haute de la boîte suivante.');return;}
    if(input){connectInput(input.dataset.input);return;}
    const n=e.target.closest('[data-node]'),l=e.target.closest('[data-link]');select(n?.dataset.node||l?.dataset.link||null,e.shiftKey);
    if(!n&&!l){pending=null;draw();}
  }
  function remove(){
    if(!selected||locked())return;
    if(current()?.type==='join'&&!selection.has(current().params.fork)){status('La clôture est obligatoire. Sélectionnez son ouverture pour la retirer.',true);return;}
    const removed=B.selection(graph,selection);
    if(edit(()=>{graph.nodes=graph.nodes.filter(n=>!removed.has(n.id));
      graph.links=graph.links.filter(l=>l.id!==selected&&!removed.has(l.from)&&!removed.has(l.to));})){
      selected=null;selection.clear();draw();properties();
    }
  }
  function insertBox(n){
    const boxes=[n];
    if(n.type==='parallel'){const j=A.node('join',id('join'),n.x,n.y+dimensions(n).h+120);j.params.fork=n.id;n.params.join=j.id;boxes.push(j);}
    view=B.place(boxes,graph.nodes,view,dimensions);graph.nodes.push(...boxes);
  }
  function copy(){
    if(!selection.size)return false;
    clipboard=B.fragment(graph,selection);draw();status(clipboard.nodes.length+' boîte(s) copiée(s), avec leurs liaisons internes.');return true;
  }
  function append(source,preserveDelay=false){
    const added=B.remap(source,graph,id,{preserveDelay});
    if(!added.nodes.length){status('Aucune boîte à ajouter.',true);return false;}
    if(!edit(()=>{view=B.place(added.nodes,graph.nodes,view,dimensions);graph.nodes.push(...added.nodes);graph.links.push(...added.links);} ))return false;
    selection=new Set(added.nodes.map(n=>n.id));selected=added.nodes[0].id;pending=null;draw();properties();return true;
  }
  function paste(){if(clipboard&&!locked()&&append(clipboard))status(clipboard.nodes.length+' boîte(s) collée(s).');}
  function duplicate(){if(!locked()&&selection.size){const source=B.fragment(graph,selection);if(append(source))status(source.nodes.length+' boîte(s) dupliquée(s).');}}
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
    const n=A.node(b.dataset.add,id('box'),0,0);
    if(n.type==='start'){let i=1;while(graph.nodes.some(b=>b.type==='start'&&b.name===n.name))n.name='Séquence '+ ++i;}
    if(edit(()=>insertBox(n)))select(n.id);
  }));
  $('properties').addEventListener('input',e=>{if(e.target.localName!=='select')eventField(e);});
  $('properties').addEventListener('change',e=>{if(e.target.matches('[data-rule-boundary],[data-rule-scale]'))commitRuleField(e.target);else if(e.target.localName==='select')eventField(e);});
  $('properties').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-rule-boundary],[data-rule-scale]')){e.preventDefault();commitRuleField(e.target);}});
  $('properties').addEventListener('click',e=>{
    const n=current();if(!n||locked())return;
    if(n.type==='action'){
      if(e.target.id==='addAction')edit(()=>{
        const items=A.actionItems(n.params),used=new Set(items.map(a=>a.command)),c=commands.find(c=>!used.has(c.id));
        n.params.actions=[...items,{command:c.id,value:c.options?c.options[0][0]:c.min}];delete n.params.command;delete n.params.value;
      });
      if(e.target.dataset.removeAction!==undefined)edit(()=>{const items=[...A.actionItems(n.params)];items.splice(Number(e.target.dataset.removeAction),1);n.params.actions=items;});
      if(e.target.dataset.moveAction!==undefined)edit(()=>{
        const items=[...A.actionItems(n.params)],from=Number(e.target.dataset.moveAction),to=from+Number(e.target.dataset.direction);
        [items[from],items[to]]=[items[to],items[from]];n.params.actions=items;
      });
      return;
    }
    if(n.type!=='ranges')return;
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
    if(e.button!==0)return;suppressClick=false;
    if(e.target.closest('[data-output],[data-input]'))return;
    const point=coordinate(e),n=graph.nodes.find(n=>n.id===e.target.closest('[data-node]')?.dataset.node);
    const boundary=e.target.closest('[data-range-boundary]');
    if(n){
      if(e.shiftKey||boundary||!selection.has(n.id)){if(!select(n.id,e.shiftKey&&!boundary))return;}
      if(locked()){suppressClick=true;return;}
      drag={node:n.id,x:point.x,y:point.y,before:snapshot(),moved:false,handled:true,
        origins:graph.nodes.filter(b=>selection.has(b.id)).map(b=>({id:b.id,x:b.x,y:b.y})),
        ...(boundary?{boundary:Number(boundary.dataset.rangeBoundary)}:{})};
    }else if(!e.target.closest('[data-link]'))drag={x:point.x,y:point.y,beforeView:{...view},moved:false,
      ...(e.shiftKey?{marquee:true,base:new Set(selection),rectangle:{x:point.x,y:point.y,w:0,h:0}}:{})};
    if(!drag)return;e.preventDefault();$('canvas').focus();
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
      }else if(drag.moved&&drag.origins.length){
        const sx=Math.max(-19000-Math.min(...drag.origins.map(b=>b.x)),Math.min(19000-Math.max(...drag.origins.map(b=>b.x)),dx));
        const sy=Math.max(-19000-Math.min(...drag.origins.map(b=>b.y)),Math.min(19000-Math.max(...drag.origins.map(b=>b.y)),dy));
        for(const origin of drag.origins){const box=graph.nodes.find(b=>b.id===origin.id);box.x=origin.x+sx;box.y=origin.y+sy;}
      }
    }
    else if(drag.marquee){
      drag.rectangle={x:Math.min(p.x,drag.x),y:Math.min(p.y,drag.y),w:Math.abs(dx),h:Math.abs(dy)};
      selection=new Set([...drag.base,...graph.nodes.filter(n=>B.overlaps(drag.rectangle,{x:n.x,y:n.y,...dimensions(n)},0)).map(n=>n.id)]);
      selected=[...selection].at(-1)||null;
    }else {view.x-=dx;view.y-=dy;}
    draw();
  });
  function finishDrag(){
    if(!drag)return;suppressClick=drag.moved||drag.handled;
    if(drag.node&&JSON.stringify(graph)!==drag.before.graph){remember(drag.before);persist();}
    const resized=drag.boundary!==undefined||drag.marquee;drag=null;draw();if(resized)properties();
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
  $('copy').addEventListener('click',copy);$('paste').addEventListener('click',paste);
  $('duplicate').addEventListener('click',duplicate);
  $('undo').addEventListener('click',()=>history(true));$('redo').addEventListener('click',()=>history(false));
  document.addEventListener('keydown',e=>{
    if(e.target.closest('input,select,textarea,[contenteditable="true"]')||$('importDialog').hasAttribute('open'))return;
    const modifier=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(!modifier)return;
    if(['c','v','z','y','a'].includes(key))e.preventDefault();
    if(key==='c')copy();else if(key==='v')paste();else if(key==='z')history(!e.shiftKey);else if(key==='y')history(false);
    else if(key==='a'){selection=new Set(graph.nodes.map(n=>n.id));selected=[...selection].at(-1)||null;draw();properties();}
  });
  $('clearGraph').addEventListener('click',()=>{if(locked())return;
    if(graph.nodes.length&&!confirm('Créer un diagramme vide ? La dernière modification pourra être annulée.'))return;
    if(edit(()=>{graph=A.emptyGraph();})){selected=null;selection.clear();pending=null;syncDocument();}
  });
  $('saveGraph').addEventListener('click',()=>{
    try{const valid=A.validate(graph,measurements.length?known():null),url=URL.createObjectURL(new Blob([JSON.stringify(valid,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=(graph.name.replace(/[^\wÀ-ÿ-]/g,'-')||'conduite')+'.centurion-conduite.json';
      a.hidden=true;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Diagramme exporté.');
    }catch(error){status(error.message,true);}
  });
  $('openGraph').addEventListener('click',()=>$('graphFile').click());
  function refreshImport(){
    const replacing=$('importMode').value==='replace';$('importChoices').hidden=replacing;
    $('importApply').textContent=replacing?'Remplacer':'Ajouter';
    $('importApply').disabled=locked()||!importGraph||!replacing&&!$('importSequences').querySelectorAll('input:checked').length;
    $('importError').textContent='';
  }
  function showImport(loaded){
    importGraph=loaded;const list=A.sequences(loaded),reachable=B.sequenceFragment(loaded,list.map(s=>s.id));
    const orphans=loaded.nodes.filter(n=>!reachable.nodes.some(b=>b.id===n.id));
    $('importName').textContent=loaded.name+' · '+loaded.nodes.length+' boîtes · '+list.length+' séquence(s)';
    $('importMode').value=graph.nodes.length?'append':'replace';
    $('importSequences').innerHTML=list.map(s=>`<label><input type="checkbox" data-sequence="${esc(s.id)}" checked><span>${esc(s.name)}<small>${B.sequenceFragment(loaded,[s.id]).nodes.length} boîte(s), y compris les parties communes</small></span></label>`).join('')
      +(orphans.length?`<label><input type="checkbox" data-orphans="true" checked><span>Boîtes sans départ<small>${orphans.length} boîte(s) en cours de construction</small></span></label>`:'');
    refreshImport();$('importDialog').showModal();
  }
  $('importMode').addEventListener('change',refreshImport);$('importSequences').addEventListener('change',refreshImport);
  for(const [button,checked] of [['importAll',true],['importNone',false]])$(button).addEventListener('click',()=>{
    for(const el of $('importSequences').querySelectorAll('input'))el.checked=checked;refreshImport();
  });
  $('importCancel').addEventListener('click',()=>{$('importDialog').close();importGraph=null;});
  $('importDialog').addEventListener('cancel',()=>{importGraph=null;});
  $('importApply').addEventListener('click',()=>{
    if(!importGraph||locked())return;let ok=false;
    if($('importMode').value==='replace'){
      ok=edit(()=>{graph=importGraph;});if(ok){selection.clear();selected=null;pending=null;syncDocument();fit();}
    }else{
      const ids=[...$('importSequences').querySelectorAll('input[data-sequence]:checked')].map(el=>el.dataset.sequence);
      const part=B.sequenceFragment(importGraph,ids);
      if($('importSequences').querySelector('input[data-orphans]:checked')){
        const all=B.sequenceFragment(importGraph,A.sequences(importGraph).map(s=>s.id)),reachable=new Set(all.nodes.map(n=>n.id));
        const included=new Set([...part.nodes.map(n=>n.id),...importGraph.nodes.filter(n=>!reachable.has(n.id)).map(n=>n.id)]);
        Object.assign(part,B.fragment(importGraph,included));
      }
      ok=append(part,true);
    }
    if(ok){$('importDialog').close();importGraph=null;status('Conduite chargée · aucune séquence lancée.');}
    else $('importError').textContent=$('editStatus').textContent;
  });
  $('graphFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file||locked())return;
    try{if(file.size>2e6)throw Error('Fichier trop volumineux (2 Mo maximum).');
      const loaded=A.validate(await file.text(),measurements.length?known():null);
      if(!locked())showImport(loaded);
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
