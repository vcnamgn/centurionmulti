(function(){
  'use strict';
  const A=window.CenturionAuto,$=id=>document.getElementById(id),STORAGE='centurion.conduite-auto.v1';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const fmt=v=>Number.isFinite(v)?v.toLocaleString('fr-FR',{maximumFractionDigits:3}):'—';
  let graph=A.emptyGraph(),runtime=A.idle(),measurements=[],values={},commands=A.actionCatalog(),connected=false,simulationRunning=false;
  let selected=null,pending=null,drag=null,undo=[],view={x:0,y:0,w:1200,h:700},suppressClick=false;
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
  function dimensions(n){return {w:230,h:n.type==='ranges'?142:n.type==='test'?112:n.type==='parallel'?112:92};}
  function portPoint(n,port){
    const {w,h}=dimensions(n);
    if(port==='in')return {x:n.x+w/2,y:n.y};
    if(port==='no-left')return {x:n.x,y:n.y+h/2};
    if(port==='no-right')return {x:n.x+w,y:n.y+h/2};
    if(n.type==='ranges'&&port.startsWith('range:')){
      const ranges=n.params.ranges,r=ranges[Number(port.split(':')[1])],min=ranges[0].min,span=ranges.at(-1).max-min;
      return {x:n.x+12+(w-24)*((r.min+r.max)/2-min)/span,y:n.y+h};
    }
    const count=1,index=0;
    return {x:n.x+w*(index+1)/(count+1),y:n.y+h};
  }
  function subtitle(n){
    const p=n.params,m=measurements.find(m=>m.id===p.variable),c=commands.find(c=>c.id===p.command);
    if(n.type==='test')return [m?.label||p.variable,`${p.operator} ${fmt(p.value)} ${m?.unit||''} · tol. ${fmt(p.tolerance)}`];
    if(n.type==='ranges')return [m?.label||p.variable,`${p.ranges.length} plages · ${m?.unit||''}`];
    if(n.type==='action')return [c?.label||p.command,c?.options?.find(([v])=>v===p.value)?.[1]||`${fmt(p.value)} ${c?.unit||''}`];
    if(n.type==='wait')return [`${fmt(p.duration)} ${{seconds:'secondes',minutes:'minutes',hours:'heures'}[p.unit]}`];
    if(n.type==='info')return [p.message];
    if(n.type==='parallel')return [`${p.actions.length} actions simultanées`];
    return [n.type==='start'?'Point de départ de la séquence':'Termine la séquence'];
  }
  function short(value,max=33){return value.length>max?value.slice(0,max-1)+'…':value;}
  function draw(){
    $('canvas').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
    $('zoomValue').textContent=Math.round(1200/view.w*100)+' %';
    $('emptyHint').hidden=Boolean(graph.nodes.length);
    $('boxes').innerHTML=graph.nodes.map(n=>{
      const {w,h}=dimensions(n),p=n.params,color={start:['#e6f5ed','#72b095'],end:['#e6f5ed','#72b095'],test:['#fff4df','#d7a861'],ranges:['#fff4df','#d7a861'],
        action:['#f1e9f7','#af87c3'],parallel:['#f1e9f7','#af87c3'],info:['#e7f2fd','#87b7d8'],wait:['#ebf1f6','#9db2c4']}[n.type];
      const active=runtime.current===n.id&&['running','paused','error'].includes(runtime.status);
      const port=(kind,incoming=false)=>{
        const point=portPoint(n,kind),label=incoming?'Entrée':kind==='yes'?'Vrai':kind.startsWith('no-')?'Faux':kind.startsWith('range:')?p.ranges[Number(kind.split(':')[1])].label:'Suite';
        return `<circle class="port ${pending?.node===n.id&&pending?.port===kind?'pending':''}" cx="${point.x}" cy="${point.y}" r="6" ${incoming?'data-input':'data-output'}="${esc(n.id)}" data-port="${kind}" role="button" tabindex="0" aria-label="${esc(n.name+' · '+label)}"><title>${esc(label)}</title></circle>`;
      };
      const range=n.type==='ranges'?p.ranges.map((r,i)=>{
        const min=p.ranges[0].min,span=p.ranges.at(-1).max-min,x=n.x+12+(w-24)*(r.min-min)/span,rw=(w-24)*(r.max-r.min)/span;
        return `<rect class="range-segment" x="${x}" y="${n.y+77}" width="${rw}" height="22" fill="${['#cde6f0','#cfead7','#f2d9b5','#e2d3ed'][i%4]}"/><text class="range-label" text-anchor="middle" x="${x+rw/2}" y="${n.y+91}">${esc(short(r.label,Math.max(1,Math.floor(rw/6))))}</text><text class="range-label" text-anchor="middle" x="${x+rw/2}" y="${n.y+116}">${esc(fmt(r.min)+'–'+fmt(r.max))}</text>`
          +(i<p.ranges.length-1?`<path class="range-divider" data-range-boundary="${i}" d="M${x+rw} ${n.y+74}V${n.y+102}"/>`:'');
      }).join(''):'';
      return `<g class="box ${selected===n.id?'selected':''} ${active?(runtime.status==='error'?'failed':'executing'):''}" data-node="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.name)}">
        <rect class="body" x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="${n.type==='start'||n.type==='end'?20:8}" fill="${color[0]}" stroke="${color[1]}"/>
        <text class="title" x="${n.x+12}" y="${n.y+24}">${esc(short(n.name,29))}</text>
        ${subtitle(n).map((t,i)=>`<text class="detail" x="${n.x+12}" y="${n.y+47+i*17}">${esc(short(t))}</text>`).join('')}${range}
        ${n.type!=='start'?port('in',true):''}${A.ports(n).map(p=>port(p)).join('')}
        ${n.type==='test'?`<text class="port-label" x="${n.x+w/2+10}" y="${n.y+h-8}">Vrai</text><text class="port-label" x="${n.x+10}" y="${n.y+h/2-7}">Faux</text><text class="port-label" text-anchor="end" x="${n.x+w-10}" y="${n.y+h/2-7}">Faux</text>`:''}
      </g>`;
    }).join('');
    $('links').innerHTML=graph.links.map(l=>{
      const a=graph.nodes.find(n=>n.id===l.from),b=graph.nodes.find(n=>n.id===l.to);
      if(!a||!b)return '';const s=portPoint(a,l.port),e=portPoint(b,'in');
      const side=l.port==='no-left'?-1:l.port==='no-right'?1:0,bend=Math.max(35,Math.abs(e.y-s.y)/2);
      const d=side?`M${s.x} ${s.y}C${s.x+side*70} ${s.y} ${e.x} ${e.y-bend} ${e.x} ${e.y}`
        :`M${s.x} ${s.y}C${s.x} ${s.y+bend} ${e.x} ${e.y-bend} ${e.x} ${e.y}`;
      return `<g data-link="${esc(l.id)}" role="button" tabindex="0" aria-label="Liaison ${esc(a.name+' vers '+b.name)}"><path class="edge ${selected===l.id?'selected':''}" d="${d}"/><path class="edge-hit" d="${d}"/></g>`;
    }).join('');
    $('delete').disabled=locked()||!selected;$('duplicate').disabled=locked()||!current();$('undo').disabled=locked()||!undo.length;
  }
  function select(value){selected=value;draw();properties();}
  function refreshSequences(){
    const previous=$('sequenceSelect').value,list=A.sequences(graph);
    $('sequenceSelect').innerHTML=list.length?list.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''):'<option value="">Créer une boîte Départ</option>';
    if(list.some(s=>s.id===previous))$('sequenceSelect').value=previous;
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
    let content=`<h2>${esc({start:'Départ',test:'Comparaison',ranges:'Règle à plages',action:'Action',info:'Information',wait:'Attente',parallel:'Actions parallèles',end:'Fin'}[n.type])}</h2><label>Nom<input data-name="true" maxlength="100" value="${esc(n.name)}"></label>`;
    if(['test','ranges'].includes(n.type)){
      content+=picker(measurements,p.variable,'variable','une mesure')+'<p class="reading" id="selectedReading"></p>';
      if(n.type==='test')content+=`<div class="row"><label>Test<select data-field="operator">${A.OPERATORS.map(v=>`<option${v===p.operator?' selected':''}>${esc(v)}</option>`).join('')}</select></label><label>Seuil<input type="number" step="any" data-field="value" value="${p.value}"></label></div>`;
      content+=`<label>Tolérance (unité de la mesure)<input type="number" min="0" step="any" data-field="tolerance" value="${p.tolerance}"></label>`;
      if(n.type==='ranges'){
        content+=p.ranges.map((r,i)=>`<div class="range-row"><label>Plage ${i+1}<input data-range="${i}" data-range-field="label" value="${esc(r.label)}" maxlength="60"></label><div class="row"><label>De<input type="number" step="any" data-range="${i}" data-range-field="min" value="${r.min}"></label><label>À<input type="number" step="any" data-range="${i}" data-range-field="max" value="${r.max}"></label></div><button class="remove-row" data-remove-range="${i}">Retirer cette plage</button></div>`).join('');
        content+='<button id="addRange">Ajouter une plage</button>';
      }
    }else if(n.type==='action')content+=actionFields(p);
    else if(n.type==='wait')content+=waitFields(p);
    else if(n.type==='info')content+=`<label>Texte<textarea data-field="message" maxlength="2000">${esc(p.message)}</textarea></label>`;
    else if(n.type==='parallel'){
      content+=p.actions.map((a,i)=>`<section class="parallel-row"><label>Action ${i+1}<select data-action-type="${i}">${['action','info','wait'].map(t=>`<option value="${t}"${a.type===t?' selected':''}>${{action:'Commande',info:'Information',wait:'Attente'}[t]}</option>`).join('')}</select></label>${a.type==='action'?actionFields(a,i):a.type==='wait'?waitFields(a,i):`<label>Texte<textarea data-field="message" data-index="${i}" maxlength="2000">${esc(a.message)}</textarea></label>`}<button class="remove-row" data-remove-action="${i}">Retirer</button></section>`).join('');
      content+='<button id="addParallelAction">Ajouter une action au lot</button>';
    }
    content+='<p class="property-note">Les changements sont appliqués dès la saisie. Pour modifier une conduite active, interrompez-la.</p>';
    $('properties').innerHTML=content;setEditingLock();updateReading();
  }
  function updateReading(){const n=current(),m=measurements.find(m=>m.id===n?.params.variable);
    if($('selectedReading'))$('selectedReading').textContent=`Valeur actuelle : ${fmt(values[n.params.variable])} ${m?.unit||''}`;}
  function setEditingLock(){
    for(const el of document.querySelectorAll('#properties input,#properties select,#properties textarea,#properties button,.library button'))el.disabled=locked();
    for(const id of ['graphName','openGraph','clearGraph'])$(id).disabled=locked();
  }
  function refreshRuntime(){
    const active=runtime.status==='running',paused=runtime.status==='paused';
    $('runStatus').textContent=runtime.message+(active&&!simulationRunning?' · simulation en pause':'')
      +(active&&runtime.remaining>0?' · '+fmt(runtime.remaining)+' s restantes':'');
    $('runStatus').dataset.error=String(runtime.status==='error');
    $('pauseSequence').disabled=!active;$('resumeSequence').disabled=!paused;$('stopSequence').disabled=!active&&!paused;
    $('runLog').innerHTML=runtime.history.slice(-25).map(h=>`<li>${fmt(h.time)} s · ${esc(h.name)} : ${esc(h.event)}</li>`).join('');
    setEditingLock();refreshSequences();draw();updateReading();
  }
  function receive(data){
    if(data?.type==='centurion-auto-init'){
      try{graph=A.validate(data.graph,new Set(data.measurements.map(d=>d.id)));measurements=data.measurements;commands=data.commands;
        runtime=data.runtime;values=data.values||{};connected=true;simulationRunning=data.simulationRunning;
        $('graphName').value=graph.name;pending=null;undo=[];
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
      const field=el.dataset.rangeField,value=field==='label'?el.value:Number(el.value);
      if(el.value==='')return;edit(()=>{n.params.ranges[Number(el.dataset.range)][field]=value;},false);return;
    }
    if(el.dataset.actionType!==undefined){
      const i=Number(el.dataset.actionType),sample=A.node(el.value,'sample');edit(()=>{n.params.actions[i]={type:el.value,...sample.params};});return;
    }
    const field=el.dataset.field;if(!field)return;
    const p=el.dataset.index!==undefined&&el.dataset.index!==''?n.params.actions[Number(el.dataset.index)]:n.params;
    const value=el.dataset.optionValue?JSON.parse(el.value):el.type==='number'?Number(el.value):el.value;
    if(el.type==='number'&&el.value==='')return;
    edit(()=>{p[field]=value;
      if(field==='command'){const c=commands.find(c=>c.id===value);p.value=c.options?c.options[0][0]:c.min;}
    },field==='command'||field==='variable');
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
    if(!selected||locked())return;edit(()=>{graph.nodes=graph.nodes.filter(n=>n.id!==selected);
      graph.links=graph.links.filter(l=>l.id!==selected&&l.from!==selected&&l.to!==selected);});selected=null;draw();properties();
  }
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
    const n=A.node(b.dataset.add,id('box'),view.x+70+(graph.nodes.length%3)*260,view.y+65+Math.floor(graph.nodes.length/3)*160);
    if(n.type==='start'){let i=1;while(graph.nodes.some(b=>b.type==='start'&&b.name===n.name))n.name='Séquence '+ ++i;}
    if(edit(()=>graph.nodes.push(n)))select(n.id);
  }));
  $('properties').addEventListener('input',e=>{if(e.target.localName!=='select')eventField(e);});
  $('properties').addEventListener('change',e=>{if(e.target.localName==='select')eventField(e);});
  $('properties').addEventListener('click',e=>{
    const n=current();if(!n||locked())return;
    if(e.target.id==='addRange')edit(()=>{
      const ranges=n.params.ranges,index=ranges.findIndex(r=>r.max-r.min===Math.max(...ranges.map(r=>r.max-r.min))),r=ranges[index],max=r.max,middle=(r.min+r.max)/2;
      r.max=middle;ranges.splice(index+1,0,{label:'Plage '+(ranges.length+1),min:middle,max});
      const original=graph.links.find(l=>l.from===n.id&&l.port===`range:${index}`);
      for(const l of graph.links)if(l.from===n.id&&l.port.startsWith('range:')&&Number(l.port.split(':')[1])>index)l.port='range:'+(Number(l.port.split(':')[1])+1);
      if(original)graph.links.push({...original,id:id('link'),port:`range:${index+1}`});
    });
    if(e.target.dataset.removeRange!==undefined)edit(()=>{const index=Number(e.target.dataset.removeRange);n.params.ranges.splice(index,1);
      graph.links=graph.links.filter(l=>!(l.from===n.id&&l.port.startsWith('range:')));});
    if(e.target.id==='addParallelAction')edit(()=>n.params.actions.push({type:'info',message:'Information de conduite'}));
    if(e.target.dataset.removeAction!==undefined)edit(()=>n.params.actions.splice(Number(e.target.dataset.removeAction),1));
  });
  $('graphName').addEventListener('input',e=>edit(()=>{graph.name=e.target.value;},false));
  $('canvas').addEventListener('click',canvasClick);
  $('canvas').addEventListener('keydown',e=>{
    if(e.key==='Escape'){pending=null;draw();return;}
    if(e.key==='Delete'){e.preventDefault();remove();return;}
    if(e.code==='Space'){e.preventDefault();fit();return;}
    if(e.key==='Enter')canvasClick(e);
  });
  $('canvas').addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('[data-output],[data-input]'))return;
    const point=coordinate(e),n=graph.nodes.find(n=>n.id===e.target.closest('[data-node]')?.dataset.node);
    const boundary=e.target.closest('[data-range-boundary]');
    if(n){select(n.id);if(locked())return;drag={node:n.id,x:point.x,y:point.y,bx:n.x,by:n.y,before:JSON.stringify(graph),moved:false,
      ...(boundary?{boundary:Number(boundary.dataset.rangeBoundary)}:{})};}
    else if(!e.target.closest('[data-link]'))drag={x:point.x,y:point.y,beforeView:{...view},moved:false};
    $('canvas').setPointerCapture(e.pointerId);
  });
  $('canvas').addEventListener('pointermove',e=>{
    if(!drag)return;const p=coordinate(e),dx=p.x-drag.x,dy=p.y-drag.y;
    if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;
    if(drag.node){const n=graph.nodes.find(n=>n.id===drag.node);
      if(drag.boundary!==undefined){
        const ranges=n.params.ranges,i=drag.boundary,span=ranges.at(-1).max-ranges[0].min;
        const value=Math.max(ranges[i].min+span/1000,Math.min(ranges[i+1].max-span/1000,ranges[0].min+(p.x-n.x-12)/(dimensions(n).w-24)*span));
        ranges[i].max=value;ranges[i+1].min=value;
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
    el.value=Math.max(el.min===''?-Infinity:Number(el.min),Math.min(el.max===''?Infinity:Number(el.max),Number(el.value)+(e.deltaY<0?step:-step)));
    eventField({target:el});
  },{passive:false});
  $('fit').addEventListener('click',fit);$('zoomIn').addEventListener('click',()=>zoom(1/1.2));$('zoomOut').addEventListener('click',()=>zoom(1.2));
  $('delete').addEventListener('click',remove);
  $('duplicate').addEventListener('click',()=>{const n=cloneNode(current());if(!n)return;
    n.id=id('box');n.x+=40;n.y+=130;n.name=short(n.name,85)+' · copie';
    while(graph.nodes.some(b=>b.type==='start'&&b.name===n.name))n.name+='2';
    if(edit(()=>graph.nodes.push(n)))select(n.id);
  });
  function cloneNode(n){return n?JSON.parse(JSON.stringify(n)):null;}
  $('undo').addEventListener('click',()=>{
    if(locked()||!undo.length)return;graph=JSON.parse(undo.pop());selected=null;pending=null;$('graphName').value=graph.name;persist();draw();properties();refreshSequences();
  });
  $('clearGraph').addEventListener('click',()=>{if(locked())return;
    if(graph.nodes.length&&!confirm('Créer un diagramme vide ? La dernière modification pourra être annulée.'))return;
    edit(()=>{graph=A.emptyGraph();});$('graphName').value=graph.name;selected=null;properties();
  });
  $('saveGraph').addEventListener('click',()=>{
    try{const valid=A.validate(graph,measurements.length?known():null),url=URL.createObjectURL(new Blob([JSON.stringify(valid,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=(graph.name.replace(/[^\wÀ-ÿ-]/g,'-')||'conduite')+'.centurion-conduite.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Diagramme exporté.');
    }catch(error){status(error.message,true);}
  });
  $('openGraph').addEventListener('click',()=>$('graphFile').click());
  $('graphFile').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file||locked())return;
    try{if(file.size>2e6)throw Error('Fichier trop volumineux (2 Mo maximum).');
      const loaded=A.validate(await file.text(),measurements.length?known():null);
      if(graph.nodes.length&&!confirm('Remplacer le diagramme courant par ce fichier ?'))return;
      if(edit(()=>{graph=loaded;})){selected=null;pending=null;$('graphName').value=graph.name;properties();fit();status('Conduite chargée · aucune séquence lancée.');}
    }catch(error){status('Ouverture impossible : '+error.message,true);}finally{e.target.value='';}
  });
  for(const [button,action] of [['startSequence','start'],['pauseSequence','pause'],['resumeSequence','resume'],['stopSequence','stop']])
    $(button).addEventListener('click',()=>post({type:'centurion-auto-command',action,sequence:$('sequenceSelect').value}));
  window.addEventListener('message',e=>{if(e.source===parent)receive(e.data);});
  window.CenturionAutoEditor={receive};
  try{const saved=localStorage.getItem(STORAGE);if(saved)graph=A.validate(saved);}catch(error){status('Conduite locale non chargée : '+error.message,true);}
  $('graphName').value=graph.name;draw();properties();refreshSequences();
  post({type:'centurion-auto-ready',graph});
})();
