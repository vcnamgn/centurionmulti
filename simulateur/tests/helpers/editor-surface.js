const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

// Surface DOM de test : exécute le script complet de l'éditeur et ses messages.
// Les données JSON, les éléments et les identifiants viennent du véritable HTML.
function editorSurface(mode='regul',{saved=null,shared=false}={}){
  const html=fs.readFileSync(path.join(__dirname,mode==='auto'?'../../centurion-conduite-auto.html':'../../centurion-cc-regul.html'),'utf8');
  const events={},frames=[],messages=[],timers=[],intervals=[],storage=new Map();let now=0,frameSerial=0,textMeasurements=0;
  if(saved)storage.set(mode==='auto'?'centurion.conduite-auto.v1':`centurion-${mode}-autosave-v1`,JSON.stringify(saved));
  const decode=text=>text.replace(/&(?:amp|lt|gt|quot|#39);/g,s=>
    ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"})[s]);
  const dataKey=name=>'data-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
  function simpleMatch(node,selector){
    if(selector==='*')return true;
    const id=/#([\w-]+)/.exec(selector)?.[1],tag=/^[\w-]+/.exec(selector)?.[0];
    return (!id||node.id===id)&&(!tag||node.localName===tag)
      &&[...selector.matchAll(/\.([\w-]+)/g)].every(([,c])=>node.classList.contains(c))
      &&[...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)]
        .every(([,k,v])=>node.hasAttribute(k)&&(v===undefined||node.getAttribute(k)===v))
      &&(!selector.includes(':checked')||node.checked);
  }
  function matches(node,selector){
    return selector.split(',').some(part=>{
      const pieces=part.trim().split(/\s+(?![^[]*\])/);let current=node;
      if(!simpleMatch(current,pieces.pop()))return false;
      while(pieces.length){const piece=pieces.pop();current=current.parentElement;
        while(current&&!simpleMatch(current,piece))current=current.parentElement;
        if(!current)return false;
      }return true;
    });
  }
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  class Element{
    constructor(tag,attrs={}){
      this.localName=tag;this.attrs=attrs;this.children=[];this.parentElement=null;
      this.listeners={};this.style={setProperty(k,v){this[k]=v;}};this._text='';
      this.value=attrs.value||'';this.checked='checked' in attrs;this.disabled='disabled' in attrs;
      this.clientWidth=1200;this.clientHeight=700;this.offsetHeight=90;this.offsetWidth=220;
      this.dataset=new Proxy({}, {get:(_,k)=>this.attrs[dataKey(k)],
        set:(_,k,v)=>{this.attrs[dataKey(k)]=String(v);return true;}});
      this.classList={contains:c=>this.className.split(/\s+/).includes(c),
        add:(...cs)=>{this.className=[...new Set([...this.className.split(/\s+/),...cs])].join(' ');},
        remove:(...cs)=>{this.className=this.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ');},
        toggle:(c,on)=>{const add=on===undefined?!this.classList.contains(c):on;
          if(add)this.classList.add(c);else this.classList.remove(c);return add;}};
    }
    get id(){return this.attrs.id||'';}set id(v){this.attrs.id=v;}
    get value(){return this._value;}set value(v){this._value=String(v);}
    get className(){return this.attrs.class||'';}set className(v){this.attrs.class=v;}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set textContent(v){this._text=String(v);this.children=[];}
    get innerHTML(){return this.textContent;}set innerHTML(v){this._text='';this.children=[];parse(String(v),this);}
    get min(){return this.attrs.min||'';}get max(){return this.attrs.max||'';}get step(){return this.attrs.step||'1';}
    get type(){return this.attrs.type||'';}
    setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]??null;}
    hasAttribute(k){return k in this.attrs;}removeAttribute(k){delete this.attrs[k];}
    appendChild(child){child.parentElement=this;this.children.push(child);return child;}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
    querySelectorAll(s){return descendants(this).filter(n=>matches(n,s));}
    querySelector(s){return this.querySelectorAll(s)[0]||null;}
    closest(s){let n=this;while(n&&!matches(n,s))n=n.parentElement;return n;}
    matches(s){return matches(this,s);}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    removeEventListener(k,fn){this.listeners[k]=(this.listeners[k]||[]).filter(listener=>listener!==fn);}
    fire(k,extra={}){return Promise.all((this.listeners[k]||[]).map(fn=>fn({type:k,target:this,preventDefault(){},stopPropagation(){},...extra})));}
    focus(){}select(){}click(){this.fire('click');}setPointerCapture(){}releasePointerCapture(){}
    showModal(){this.setAttribute('open','');}close(){this.removeAttribute('open');}
    getBoundingClientRect(){return {left:0,top:0,right:1200,bottom:700,width:1200,height:700};}
    getContext(){return new Proxy({measureText:t=>(textMeasurements++,{width:String(t).length*7})},{get:(o,k)=>o[k]||(()=>{})});}
    createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}};}
    getScreenCTM(){return {inverse(){return {};}};}
  }
  function parse(fragment,parent){
    const stack=[parent],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    for(const [token] of fragment.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<\/?[a-z][^>]*>|[^<]+/gi)){
      if(token.startsWith('<!--'))continue;
      if(token.startsWith('</')){const tag=/^<\/([\w-]+)/.exec(token)[1];
        const index=stack.findLastIndex(n=>n.localName===tag);if(index>0)stack.splice(index);continue;}
      if(token.startsWith('<')){
        const tag=/^<([\w-]+)/.exec(token)[1],opening=token.slice(0,token.indexOf('>')+1);
        const attrs=Object.fromEntries([...opening.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
          .slice(1).map(([,k,a,b,c])=>[k,decode(a??b??c??'')]));
        const node=new Element(tag,attrs);stack.at(-1).appendChild(node);
        if(tag==='script'||tag==='style')node._text=token.slice(opening.length,token.lastIndexOf('</'));
        else if(!voidTags.has(tag)&&!opening.endsWith('/>'))stack.push(node);
      }else stack.at(-1)._text+=decode(token);
    }
  }
  const root=new Element('document');parse(html,root);
  for(const select of root.querySelectorAll('select')){
    const option=select.querySelectorAll('option').find(o=>o.hasAttribute('selected'))||select.querySelector('option');
    if(option)select.value=option.getAttribute('value')??option.textContent;
  }
  const document={body:root.querySelector('body'),documentElement:root.querySelector('html'),activeElement:null,
    getElementById:id=>root.querySelector('#'+id),querySelector:s=>root.querySelector(s),
    querySelectorAll:s=>root.querySelectorAll(s),createElement:t=>new Element(t),
    createElementNS:(_,t)=>new Element(t),addEventListener:(k,fn)=>(events['document-'+k]??=[]).push(fn)};
  const parent={postMessage:data=>messages.push(data)};
  const window={parent,devicePixelRatio:1,addEventListener:(k,fn)=>(events[k]??=[]).push(fn)};
  const context=vm.createContext({document,window,parent,location:{search:'?mode='+mode+(shared?'&shared=1':'')},console,
    performance:{now:()=>now},requestAnimationFrame:fn=>{fn.frameId=++frameSerial;frames.push(fn);return fn.frameId;},
    cancelAnimationFrame:id=>{const i=frames.findIndex(fn=>fn.frameId===id);if(i>=0)frames.splice(i,1);},
    setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){},setInterval:fn=>(intervals.push(fn),intervals.length),
    ResizeObserver:class{observe(){}},URLSearchParams,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    Blob,URL});
  const main=root.querySelectorAll('script').find(n=>!n.hasAttribute('src')&&!n.hasAttribute('type'));
  if(mode==='auto'){
    for(const name of ['centurion-auto.js','centurion-orthogonal-routing.js','centurion-auto-routing.js','centurion-auto-editing.js','centurion-conduite-auto.js'])
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../../'+name),'utf8'),context,{filename:name});
    return {messages,storage,get:id=>document.getElementById(id),query:s=>document.querySelector(s),queryAll:s=>document.querySelectorAll(s),
      receive:data=>window.CenturionAutoEditor.receive(data),flushTimers(){while(timers.length)timers.shift()();},
      graph:()=>JSON.parse(storage.get('centurion.conduite-auto.v1')||JSON.stringify(saved)),
      realTime:ms=>{now=ms;for(const fn of intervals)fn();},
      get pendingFrames(){return frames.length;},get textMeasurements(){return textMeasurements;},
      frame(time=100){const fn=frames.shift();if(!fn)throw Error('aucune trame');fn(time);},
      focus:el=>{document.activeElement=el;},
      key:(key,extra={})=>{for(const fn of events['document-keydown']||[])fn({key,target:document.body,preventDefault(){},...extra});},
      event:(id,event,target,extra={})=>document.getElementById(id).fire(event,{target,...extra})};
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../centurion-cc-pzr.js'),'utf8'),context,
    {filename:'centurion-cc-pzr.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../centurion-orthogonal-routing.js'),'utf8'),context,
    {filename:'centurion-orthogonal-routing.js'});
  vm.runInContext(main.textContent,context,{filename:'centurion-cc-regul.html'});
  return {messages,storage,bridge:window.CenturionCC,get:id=>document.getElementById(id),get pendingFrames(){return frames.length;},
    query:s=>document.querySelector(s),queryAll:s=>document.querySelectorAll(s),
    flushTimers(){while(timers.length)timers.shift()();},
    receive(data){for(const fn of events.message||[])fn({data,source:parent});},
    frame(time=100){const fn=frames.shift();if(!fn)throw Error('aucune trame');fn(time);},
    state:()=>vm.runInContext('({nodes:regNodes,links:regLinks,enabled:regulationEnabled,signals:regLastSignals})',context)};
}
module.exports={editorSurface};
