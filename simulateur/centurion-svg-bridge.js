/* Exécuté dans les SVG chargés par <object>, y compris depuis file://. */
(function () {
  "use strict";
  const root=document.documentElement;
  const file=decodeURIComponent(location.pathname).toUpperCase();
  const semantic=root.getAttribute("data-centurion-diagram");
  const kind=semantic||(file.includes("RCPGRAPPES")?"rods":file.includes("RCPPZR")?"pzr":
    file.includes("RCPGV")?"gv":"rcp");
  const fmt=(value,d=0)=>Number(value).toLocaleString("fr-FR",{
    minimumFractionDigits:d,maximumFractionDigits:d});
  const set=(id,value)=>{const e=document.getElementById(id);if(e)e.textContent=value;};
  const read=(data,path)=>path.split(".").reduce((value,key)=>value?.[key],data);
  const nodes=selector=>Array.from(root.querySelectorAll(selector));
  let gv=1;

  function ptPlot() {
    const node=document.getElementById("pt-plot-area");
    const number=(name,fallback)=>node?.hasAttribute(name)?Number(node.getAttribute(name)):fallback;
    const left=number("x",105),top=number("y",100),width=number("width",1060),height=number("height",610);
    const tMin=number("data-temperature-min",0),tMax=number("data-temperature-max",370);
    const pMin=number("data-pressure-min",0),pMax=number("data-pressure-max",180);
    return {left,top,width,height,tMin,tMax,pMin,pMax,
      x:t=>left+(t-tMin)/(tMax-tMin)*width,
      y:p=>top+height-(p-pMin)/(pMax-pMin)*height};
  }
  function bindPtProbe() {
    if(kind!=="pt")return;
    const group=document.getElementById("pt-probe");
    if(!group)return;
    let locked=false,position=null;
    const publish=()=>window.parent?.postMessage({type:"centurion-pt-probe",kind,locked,
      temperatureC:position?.temperatureC,pressureBar:position?.pressureBar},"*");
    const paint=()=>{
      group.setAttribute("visibility",position?"visible":"hidden");
      root.setAttribute("data-pt-probe-locked",String(locked));
      if(!position)return;
      const plot=ptPlot(),x=plot.x(position.temperatureC),y=plot.y(position.pressureBar);
      document.getElementById("pt-probe-vertical").setAttribute("d",`M${x} ${plot.top}V${plot.top+plot.height}`);
      document.getElementById("pt-probe-horizontal").setAttribute("d",`M${plot.left} ${y}H${plot.left+plot.width}`);
      document.getElementById("pt-probe-point").setAttribute("cx",x);
      document.getElementById("pt-probe-point").setAttribute("cy",y);
      const tx=Math.max(plot.left,Math.min(plot.left+plot.width-90,x-45));
      const py=Math.max(plot.top,Math.min(plot.top+plot.height-27,y-13.5));
      document.getElementById("pt-probe-temperature").setAttribute("transform",`translate(${tx} ${plot.top+plot.height+7})`);
      document.getElementById("pt-probe-pressure").setAttribute("transform",`translate(${plot.left-97} ${py})`);
      set("pt-probe-temperature-value",`${fmt(position.temperatureC,1)} °C`);
      set("pt-probe-pressure-value",`${fmt(position.pressureBar,1)} bar`);
    };
    const locate=event=>{
      const box=root.getAttribute("viewBox").trim().split(/[\s,]+/).map(Number);
      const rect=root.getBoundingClientRect(),scale=Math.min(rect.width/box[2],rect.height/box[3]);
      if(!(scale>0)||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return null;
      const x=box[0]+(event.clientX-rect.left-(rect.width-box[2]*scale)/2)/scale;
      const y=box[1]+(event.clientY-rect.top-(rect.height-box[3]*scale)/2)/scale;
      const p=ptPlot();
      if(x<p.left||x>p.left+p.width||y<p.top||y>p.top+p.height)return null;
      return {temperatureC:p.tMin+(x-p.left)/p.width*(p.tMax-p.tMin),
        pressureBar:p.pMin+(p.top+p.height-y)/p.height*(p.pMax-p.pMin)};
    };
    const release=()=>{locked=false;position=null;paint();publish();};
    root.addEventListener("pointermove",event=>{
      if(locked||event.buttons)return;
      position=locate(event);paint();root.style.cursor=position?"crosshair":"grab";
    });
    root.addEventListener("pointerleave",()=>{if(!locked){position=null;paint();}});
    root.addEventListener("wheel",event=>{if(!locked&&event.ctrlKey){position=locate(event);paint();}});
    root.addEventListener("click",event=>{
      if(locked||event.button>0)return;
      const next=locate(event);if(!next)return;
      position=next;locked=true;paint();publish();
    });
    window.addEventListener("message",event=>{
      if(event.source===window.parent&&event.data?.type==="centurion-pt-probe-command"
        &&event.data.action==="release")release();
    });
    release();
  }

  // Le zoom appartient au document SVG : les événements traversent ainsi
  // correctement les <object>, même avec l'origine opaque de file://.
  function bindViewport() {
    const base=(root.getAttribute("viewBox")||"").trim().split(/[\s,]+/).map(Number);
    if(base.length!==4||!base.every(Number.isFinite)||base[2]<=0||base[3]<=0)return;
    let box=[...base],zoom=1,drag=null,suppressClick=false;
    const publish=()=>window.parent?.postMessage({type:"centurion-svg-viewport",kind,zoom},"*");
    const apply=()=>{
      box[0]=Math.max(base[0]-box[2]*.85,Math.min(base[0]+base[2]-box[2]*.15,box[0]));
      box[1]=Math.max(base[1]-box[3]*.85,Math.min(base[1]+base[3]-box[3]*.15,box[1]));
      root.setAttribute("viewBox",box.join(" "));
    };
    const mapping=()=>{
      const r=root.getBoundingClientRect(),scale=Math.min(r.width/box[2],r.height/box[3]);
      return {scale,left:r.left+(r.width-box[2]*scale)/2,top:r.top+(r.height-box[3]*scale)/2};
    };
    const zoomAt=(factor,clientX,clientY)=>{
      const m=mapping();if(!(m.scale>0))return;
      const ax=Number.isFinite(clientX)?clientX:m.left+box[2]*m.scale/2;
      const ay=Number.isFinite(clientY)?clientY:m.top+box[3]*m.scale/2;
      const px=box[0]+(ax-m.left)/m.scale,py=box[1]+(ay-m.top)/m.scale;
      const next=Math.max(.75,Math.min(6,zoom*factor)),ratio=zoom/next;
      box=[px-(px-box[0])*ratio,py-(py-box[1])*ratio,box[2]*ratio,box[3]*ratio];
      zoom=next;apply();publish();
    };
    root.style.cursor="grab";root.style.userSelect="none";root.style.touchAction="none";
    const fit=()=>{box=[...base];zoom=1;apply();publish();};
    if(!root.hasAttribute("tabindex"))root.setAttribute("tabindex","0");
    root.addEventListener("wheel",event=>{
      if(!event.ctrlKey||!event.deltaY)return;
      event.preventDefault();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?400:1);
      zoomAt(Math.exp(-Math.max(-200,Math.min(200,delta))*.002),event.clientX,event.clientY);
    },{passive:false});
    root.addEventListener("keydown",event=>{
      if((event.code!=="Space"&&event.key!==" ")||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
      let target=event.target;
      while(target&&target!==root){
        if(target.isContentEditable||["input","select","textarea","button","a"].includes(target.localName)
          ||target.getAttribute?.("role")==="link"||target.hasAttribute?.("data-navigation"))return;
        target=target.parentElement;
      }
      event.preventDefault();fit();
    });
    root.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;
      suppressClick=false;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,box:[...box],scale:mapping().scale,moved:false};
    });
    root.addEventListener("pointermove",event=>{
      if(!drag||drag.id!==event.pointerId||!(drag.scale>0))return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<4)return;
      if(!drag.moved){drag.moved=true;root.setPointerCapture(event.pointerId);root.style.cursor="grabbing";}
      event.preventDefault();
      box=[drag.box[0]-dx/drag.scale,drag.box[1]-dy/drag.scale,box[2],box[3]];apply();
    });
    const finish=event=>{
      if(!drag||drag.id!==event.pointerId)return;
      suppressClick=drag.moved;
      if(drag.moved&&root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
      drag=null;root.style.cursor="grab";
    };
    root.addEventListener("pointerup",finish);root.addEventListener("pointercancel",finish);
    root.addEventListener("lostpointercapture",()=>{drag=null;root.style.cursor="grab";});
    root.addEventListener("click",event=>{
      if(!suppressClick)return;
      suppressClick=false;event.preventDefault();event.stopImmediatePropagation();
    },true);
    window.addEventListener("message",event=>{
      if(event.source!==window.parent||event.data?.type!=="centurion-svg-viewport-command")return;
      if(event.data.action==="fit")fit();
      else if(event.data.action==="in")zoomAt(1.25);
      else if(event.data.action==="out")zoomAt(1/1.25);
    });
  }

  function levelY(node,value){
    const top=Number(node.getAttribute("data-level-top"));
    const bottom=Number(node.getAttribute("data-level-bottom"));
    return bottom-(bottom-top)*Math.max(0,Math.min(100,value))/100;
  }
  function updateSemantic(data){
    gv=Math.max(1,Math.min(4,Math.trunc(Number(data.gv)||1)));
    root.setAttribute("data-loop",String(gv));
    root.setAttribute("data-simulation-time",String(data.time));
    for(const node of nodes("[data-gv-template]"))
      node.textContent=node.getAttribute("data-gv-template").replaceAll("{gv}",String(gv));
    const others=[1,2,3,4].filter(n=>n!==gv);
    for(const node of nodes("[data-other-gv-slot]")){
      const number=others[Number(node.getAttribute("data-other-gv-slot"))];
      node.setAttribute("data-navigation-gv",String(number));
      node.querySelector("text").textContent=`GV${number}`;
    }
    for(const node of nodes("[data-value]")){
      const path=node.getAttribute("data-value"),value=read(data,path);
      const available=typeof value==="number"&&Number.isFinite(value);
      const number=available?fmt(value,Number(node.getAttribute("data-decimals"))||0):"—";
      node.textContent=node.getAttribute("data-template").replaceAll("{gv}",String(gv)).replaceAll("{value}",number);
      node.setAttribute("data-available",String(available));
      node.setAttribute("data-current-value",available?String(value):"");
      node.setAttribute("aria-label",`${node.textContent} ${node.getAttribute("data-unit")||""}`.trim());
    }
    for(const node of nodes("[data-text-value]")){
      const value=read(data,node.getAttribute("data-text-value"));
      node.textContent=typeof value==="string"?value:"—";
    }
    for(const node of nodes("[data-level-value]")){
      const value=read(data,node.getAttribute("data-level-value"));
      if(!Number.isFinite(value))continue;
      const y=levelY(node,value),bottom=Number(node.getAttribute("data-fill-bottom"));
      node.setAttribute("y",String(y));node.setAttribute("height",String(Math.max(0,bottom-y)));
    }
    for(const node of nodes("[data-line-value]")){
      const value=read(data,node.getAttribute("data-line-value"));
      if(!Number.isFinite(value))continue;
      node.setAttribute("d",node.getAttribute("data-line-template").replaceAll("{y}",String(levelY(node,value))));
    }
    for(const node of nodes("[data-follow-level]")){
      const value=read(data,node.getAttribute("data-follow-level"));
      if(Number.isFinite(value))node.setAttribute("y",String(levelY(node,value)+Number(node.getAttribute("data-follow-offset"))));
    }
    for(const node of nodes("[data-actuator]")){
      const value=read(data,node.getAttribute("data-actuator"));
      node.setAttribute("data-opening-pct",String(value));
      for(const body of node.querySelectorAll("[data-actuator-body]")){
        if(body._centurionFill===undefined)body._centurionFill=body.style.fill||"";
        body.style.fill=value>0?"#8bd8e9":body._centurionFill;
      }
      const title=node.querySelector("[data-actuator-title]");
      if(title)title.textContent=`Ouverture réalisée : ${Number.isFinite(value)?fmt(value,1):"—"} %`;
    }
    for(const node of nodes("[data-pump]")){
      const loop=read(data,node.getAttribute("data-pump"));
      if(!loop)continue;
      const state=!loop.pumpStopped?"running":loop.forcedFlowKgS>1?"coasting":"stopped";
      node.setAttribute("data-pump-state",state);
      const body=node.querySelector("circle");
      if(body){if(body._centurionFill===undefined)body._centurionFill=body.style.fill||"";
        body.style.fill=state==="stopped"?"#d9e0e6":body._centurionFill;}
      node.querySelector("[data-pump-title]").textContent=
        `Débit de boucle : ${fmt(loop.flowKgS)} kg/s (${fmt(loop.flowPct,1)} %) ; thermosiphon : ${fmt(loop.naturalFlowKgS)} kg/s`;
    }
    for(const node of nodes("[data-flow]")){
      const value=read(data,node.getAttribute("data-flow"));
      node.setAttribute("data-flowing",String(value>0.01));
      for(const body of node.querySelectorAll("rect")){
        if(body._centurionFill===undefined)body._centurionFill=body.style.fill||"";
        body.style.fill=value>0.01?"#ccebf4":body._centurionFill;
      }
    }
    for(const node of nodes("[data-alarm]"))
      node.setAttribute("data-flow-alarm",String(Boolean(read(data,node.getAttribute("data-alarm")))));
    for(const node of nodes("[data-visible-positive]"))
      node.style.display=read(data,node.getAttribute("data-visible-positive"))>1?"":"none";
    if(kind==="inventory") {
      document.getElementById("balance-net-card")?.setAttribute("data-balance-sign",
        data.massBalance.netKgS>0.05?"gain":data.massBalance.netKgS<-.05?"loss":"balanced");
      const line=document.getElementById("cpp-waterline");
      if(line){
        const scale=Number(line.getAttribute("data-metres-scale"))||21;
        const zero=Number(line.getAttribute("data-metres-zero"))||764;
        const x1=Number(line.getAttribute("data-marker-x1"))||90;
        const x2=Number(line.getAttribute("data-marker-x2"))||125;
        line.setAttribute("d",`M${x1} ${zero-scale*data.inventory.levelM}H${x2}`);
      }
    }
    if(kind==="pt") {
      const {x,y}=ptPlot();
      const path=points=>{
        let connected=false;
        return points.map(v=>{
          if(!v.every(Number.isFinite)){connected=false;return "";}
          const command=connected?"L":"M";connected=true;
          return `${command}${x(v[0]).toFixed(2)} ${y(v[1]).toFixed(2)}`;
        }).filter(Boolean).join(" ");
      };
      const write=(id,points)=>document.getElementById(id)?.setAttribute("d",path(points));
      const curves=data.ptCurves||{lower:[],upper:[],saturation:[]};
      write("pt-lower",curves.lower);write("pt-upper",curves.upper);write("pt-saturation",curves.saturation);
      const polygon=[...curves.lower,...[...curves.upper].reverse()];
      document.getElementById("pt-domain")?.setAttribute("d",path(polygon)+" Z");
      for(const [suffix,historyKey,currentKey] of [["-cold","cold","coldC"],["-hot","hot","hotC"],["","tavg","tavgC"]]){
        write(`pt-trace${suffix}`,(data.ptHistory||[]).map(p=>[p[historyKey],p.pressure]));
        const point=document.getElementById(`pt-point${suffix}`);
        const available=Number.isFinite(data[currentKey])&&Number.isFinite(data.pressure);
        if(point){
          point.style.display=available?"":"none";
          if(available){point.setAttribute("cx",String(x(data[currentKey])));point.setAttribute("cy",String(y(data.pressure)));}
        }
      }
      document.getElementById("pt-point")?.setAttribute("data-flow-alarm",String(Boolean(data.alarms.pt)));
    }
  }
  function bindNavigation(){
    for(const node of nodes("[data-navigation]")){
      const diagram=node.getAttribute("data-navigation");
      if(!diagram)continue;
      const activate=event=>{
        if(event.type==="keydown"&&!["Enter"," "].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        const number=node.getAttribute("data-navigation-gv");
        navigate({diagram,gv:number==="selected"?gv:Number(number)||gv});
      };
      node.addEventListener("click",activate);node.addEventListener("keydown",activate);
    }
  }
  function destination(label){
    const name=label.replace(/\s+/g," ").trim().toUpperCase();
    const match=/^GV\s*([1-4])$/.exec(name);
    if(match)return {diagram:"gv",gv:Number(match[1])};
    if(name==="PZR"||name==="PRESSURISEUR")return {diagram:"pzr"};
    if(name==="GRAPPES"||name==="POSITION DES GRAPPES")return {diagram:"rods"};
    if(name==="RCP")return {diagram:"rcp"};
    return null;
  }
  function arrowGroup(text){
    let node=text;
    for(let i=0;i<5&&node;i++,node=node.parentElement){
      if(node.localName==="g" && (/^renvoi-/i.test(node.id||"") ||
        node.querySelector('polygon[fill="#b79af7"],path[fill="#b79af7"],path[style*="#b79af7"]')))return node;
    }
    return text;
  }
  function navigate(target){
    if(window.parent && window.parent!==window)
      window.parent.postMessage({type:"centurion-svg-navigate",...target},"*");
    else {
      const files={rcp:"synoptique-RCP-1300.svg",gv:"synoptique-RCPGV-1300.svg",
        pzr:"synoptique-RCPPZR-1300.svg",rods:"synoptique-RCPGRAPPES-1300.svg"};
      if(files[target.diagram])location.href=files[target.diagram];
    }
  }
  function bindArrows(){
    const purple='polygon[fill="#b79af7"],path[fill="#b79af7"],path[style*="#b79af7"]';
    const grayShape=shape=>{shape.style.fill="#b9c1c8";shape.style.stroke="#737e88";};
    const grayArrow=(node,text)=>{
      if(node!==text){node.querySelectorAll(purple).forEach(grayShape);return;}
      const r=text.getBoundingClientRect(),cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
      for(const shape of root.querySelectorAll(purple)){
        const b=shape.getBoundingClientRect();
        if(cx>=b.left-3&&cx<=b.right+3&&cy>=b.top-3&&cy<=b.bottom+3)grayShape(shape);
      }
    };
    const seen=new Set();
    for(const text of root.querySelectorAll("text")){
      const label=text.textContent.trim();
      const target=destination(label);
      const node=arrowGroup(text);
      if(target){
        if(seen.has(node))continue;
        seen.add(node);node.style.cursor="pointer";
        node.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();
          navigate(destination(text.textContent)||target);});
      } else if(/^(RCV|RIS(?: MP| BP)? ?[1-4]?|RRA ?[1-4]?|ASG|ARE)$/i.test(label)){
        grayArrow(node,text);
        node.style.cursor="default";
      }
    }
    if(kind==="rcp"){
      const arrow=document.getElementById("path45220");
      if(arrow){arrow.style.cursor="pointer";arrow.addEventListener("click",()=>navigate({diagram:"rods"}));}
    }
  }
  function updateRods(data){
    set("puissance-electrique",`${fmt(data.power,1)} %`);
    set("compteur-g3",data.tripAt===null?fmt(data.g3):"—");
    for(const [name,p] of Object.entries(data.rods||{})){
      set(`position-${name}`,fmt(p));
      const group=document.getElementById(`groupe-${name}`);
      if(group)group.setAttribute("data-position-pas-extraits",Number(p).toFixed(1));
      const fill=document.getElementById(`remplissage-${name}`);
      if(fill)fill.setAttribute("height",String(Math.max(0,360*(260-p)/260)));
    }
    const y=383+360*(260-data.rLimit)/260;
    const line=document.getElementById("limite-R");
    if(line)line.setAttribute("d",`M146.5 ${y.toFixed(2)}H233.5`);
    const label=document.getElementById("valeur-limite-R");
    if(label){label.setAttribute("y",String(y-11));label.textContent=`IL ${fmt(data.rLimit)}`;}
    const power=Math.max(0,Math.min(100,Number(data.power)||0));
    const actualPower=Math.max(0,Math.min(100,Number(data.power)||0));
    const g3=Math.max(200,Math.min(780,Number(data.g3)||200));
    const point=document.getElementById("point-g3");
    const px=118+(g3-200)*512/580,py=1095-1.35*actualPower;
    if(point){point.setAttribute("cx",px.toFixed(1));point.setAttribute("cy",py.toFixed(1));
      point.style.visibility=data.tripAt===null?"visible":"hidden";}
    const pointLabel=document.getElementById("libelle-point-g3");
    if(pointLabel){pointLabel.style.visibility=data.tripAt===null?"visible":"hidden";
      pointLabel.setAttribute("x",String(px-12));
      pointLabel.setAttribute("y",String(py-11));pointLabel.textContent=`${fmt(actualPower,1)} % / ${fmt(g3)}`;}
    const il1=202-.16*power,il2=211-.13*power,ix=135+4.85*power;
    for(const [suffix,limit] of [["premiere",il1],["seconde",il2]]){
      const iy=1380-(limit-180)*2.4;
      const circle=document.getElementById(`point-il-${suffix}`);
      const note=document.getElementById(`libelle-il-${suffix}`);
      if(circle){circle.setAttribute("cx",ix.toFixed(1));circle.setAttribute("cy",iy.toFixed(1));}
      if(note){note.setAttribute("x",String(ix-5));note.setAttribute("y",String(iy-7));
        note.textContent=fmt(limit);}
    }
  }
  window.addEventListener("message",event=>{
    if(event.source!==window.parent)return;
    const data=event.data;
    if(!data)return;
    if(data.type==="centurion-svg-capture-request"){
      // Le même rendu sert à l'écran et au certificat, même en fichier local.
      if(semantic)updateSemantic(data.snapshot);
      else if(kind==="rods")updateRods(data.snapshot);
      const copy=root.cloneNode(true);
      // Le réticule est une lecture de l'utilisateur, pas un état physique du certificat.
      copy.querySelector('[data-pt-probe]')?.setAttribute("visibility","hidden");
      copy.querySelectorAll("script").forEach(node=>node.remove());
      copy.querySelectorAll("*").forEach(node=>{
        // Les métadonnées RDF/Inkscape ne sont pas des SVGElement et ne
        // possèdent pas de style dans un vrai navigateur.
        if(node.style){node.style.animation="none";node.style.transition="none";}
      });
      window.parent.postMessage({type:"centurion-svg-capture-result",requestId:data.requestId,
        kind,svg:new XMLSerializer().serializeToString(copy)},"*");
      return;
    }
    if(data.type!=="centurion-state")return;
    if(semantic)updateSemantic(data);
    else if(kind==="rods")updateRods(data);
  });
  bindViewport();
  bindPtProbe();
  if(semantic)bindNavigation();else bindArrows();
  if(window.parent&&window.parent!==window)
    window.parent.postMessage({type:"centurion-svg-ready",kind},"*");
})();
