/* Tracé commun aux ateliers : chemins simples d'abord, recherche de grille en secours. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CenturionOrthogonalRouting=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const direction={right:{x:1,y:0},left:{x:-1,y:0},down:{x:0,y:1},up:{x:0,y:-1}};
  const equal=(a,b)=>a.x===b.x&&a.y===b.y;
  function simplify(points){
    const result=[];
    for(const p of points){if(result.length&&equal(result.at(-1),p))continue;
      while(result.length>1){const a=result.at(-2),b=result.at(-1);
        if(a.x===b.x&&b.x===p.x&&(b.y-a.y)*(p.y-b.y)>=0||a.y===b.y&&b.y===p.y&&(b.x-a.x)*(p.x-b.x)>=0)result.pop();else break;}
      result.push(p);
    }return result;
  }
  function crosses(p,q,r){
    if(p.y===q.y)return p.y>r.top&&p.y<r.bottom&&Math.max(p.x,q.x)>r.left&&Math.min(p.x,q.x)<r.right;
    if(p.x===q.x)return p.x>r.left&&p.x<r.right&&Math.max(p.y,q.y)>r.top&&Math.min(p.y,q.y)<r.bottom;
    return true;
  }
  const path=points=>points.map((p,i)=>!i?`M${p.x} ${p.y}`:p.x===points[i-1].x?`V${p.y}`:`H${p.x}`).join('');
  function createRouter({padding=12,stub=24}={}){
    let signature=null,prepared=null;
    const stats={requests:0,cacheHits:0,simple:0,searches:0};
    function prepare(nodes){
      const key=JSON.stringify(nodes.map(n=>[n.id,n.x,n.y,n.w,n.h]));
      if(key===signature)return prepared;signature=key;
      const rects=nodes.map(n=>({id:n.id,left:n.x-padding,right:n.x+n.w+padding,top:n.y-padding,bottom:n.y+n.h+padding}));
      const cache=new Map(),baseX=[...new Set(rects.flatMap(r=>[r.left,r.right]))],baseY=[...new Set(rects.flatMap(r=>[r.top,r.bottom]))];
      const inside=p=>rects.some(r=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom);
      const clear=(p,q)=>!rects.some(r=>crosses(p,q,r));
      const valid=points=>points.every((p,i)=>!inside(p)&&(!i||clear(points[i-1],p)));
      function search(a,b,initialDirection){
        stats.searches++;
        const xs=[...new Set([...baseX,a.x,b.x])].sort((a,b)=>a-b),ys=[...new Set([...baseY,a.y,b.y])].sort((a,b)=>a-b);
        const key=(x,y,dir)=>(y*xs.length+x)*2+dir,point=(x,y)=>({x:xs[x],y:ys[y]});
        const x0=xs.indexOf(a.x),y0=ys.indexOf(a.y),x1=xs.indexOf(b.x),y1=ys.indexOf(b.y);
        const heuristic=(x,y)=>Math.abs(xs[x]-b.x)+Math.abs(ys[y]-b.y),heap=[];
        function push(v){let i=heap.push(v)-1;while(i){const p=(i-1)>>1;if(heap[p].score<=v.score)break;heap[i]=heap[p];i=p;}heap[i]=v;}
        function pop(){const v=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].score<heap[c].score)c++;if(heap[c].score>=last.score)break;heap[i]=heap[c];i=c;}heap[i]=last;}return v;}
        const first={x:x0,y:y0,dir:initialDirection,cost:0,score:heuristic(x0,y0),parent:null};push(first);
        const best=new Map([[key(x0,y0,first.dir),0]]),freePoints=new Map(),freeEdges=new Map();let explored=0;
        while(heap.length&&explored++<20000){
          const c=pop();if(c.cost!==best.get(key(c.x,c.y,c.dir)))continue;
          if(c.x===x1&&c.y===y1){const result=[];for(let p=c;p;p=p.parent)result.push(point(p.x,p.y));return result.reverse();}
          for(const [dx,dy,dir] of [[-1,0,0],[1,0,0],[0,-1,1],[0,1,1]]){
            const x=c.x+dx,y=c.y+dy;if(x<0||y<0||x>=xs.length||y>=ys.length)continue;
            const pi=c.y*xs.length+c.x,qi=y*xs.length+x,edge=pi<qi?pi+'/'+qi:qi+'/'+pi;
            const p=point(c.x,c.y),q=point(x,y);
            if(!freePoints.has(qi))freePoints.set(qi,!inside(q));
            if(!freePoints.get(qi))continue;
            if(!freeEdges.has(edge))freeEdges.set(edge,clear(p,q));
            if(!freeEdges.get(edge))continue;
            const cost=c.cost+Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+(dir!==c.dir?18:0),k=key(x,y,dir);
            if(cost>=(best.get(k)??Infinity))continue;best.set(k,cost);push({x,y,dir,cost,score:cost+heuristic(x,y),parent:c});
          }
        }return null;
      }
      function route(request){
        stats.requests++;const cacheKey=JSON.stringify(request);
        if(cache.has(cacheKey)){stats.cacheHits++;return cache.get(cacheKey);}
        const s=request.start,e=request.end,sd=direction[request.startDirection||'down'],ed=direction[request.endDirection||'up'];
        const foreign=rects.filter(r=>r.id!==request.from&&r.id!==request.to);
        // Réduire l'accès dans un petit intervalle sans entrer dans la boîte voisine.
        const access=(p,d)=>{
          let length=stub;
          for(const r of foreign){
            if(d.x&&p.y>r.top&&p.y<r.bottom){const distance=(d.x>0?r.left-p.x:p.x-r.right);if(distance>=0)length=Math.min(length,distance);}
            if(d.y&&p.x>r.left&&p.x<r.right){const distance=(d.y>0?r.top-p.y:p.y-r.bottom);if(distance>=0)length=Math.min(length,distance);}
          }
          // L'autre extrémité est aussi un obstacle pendant le tracé central.
          const opposite=rects.find(r=>r.id===(p===s?request.to:request.from));
          if(opposite&&request.from!==request.to){
            if(d.x&&p.y>opposite.top&&p.y<opposite.bottom){const distance=(d.x>0?opposite.left-p.x:p.x-opposite.right);if(distance>=0)length=Math.min(length,distance);}
            if(d.y&&p.x>opposite.left&&p.x<opposite.right){const distance=(d.y>0?opposite.top-p.y:p.y-opposite.bottom);if(distance>=0)length=Math.min(length,distance);}
          }
          return {x:p.x+d.x*length,y:p.y+d.y*length};
        };
        const a=access(s,sd),b=access(e,ed);
        let result;
        const straight=(sd.x&&s.y===e.y&&(e.x-s.x)*sd.x>=0||sd.y&&s.x===e.x&&(e.y-s.y)*sd.y>=0)&&sd.x===-ed.x&&sd.y===-ed.y;
        if(straight&&!foreign.some(r=>crosses(s,e,r))){stats.simple++;result={points:simplify([s,e]),blocked:false};}
        else if(inside(a)||inside(b)||foreign.some(r=>crosses(s,a,r)||crosses(b,e,r)))result={points:[s],blocked:true};
        else{
          const simple=[simplify([a,{x:b.x,y:a.y},b]),simplify([a,{x:a.x,y:b.y},b])];
          const score=ps=>ps.reduce((v,p,i)=>!i?v:v+Math.abs(p.x-ps[i-1].x)+Math.abs(p.y-ps[i-1].y)+18*(i>1),0);
          let chosen=simple.filter(valid).sort((a,b)=>score(a)-score(b))[0];
          if(!chosen){
            const rails=[...new Set([a.x,b.x,(a.x+b.x)/2,...baseX])].map(x=>simplify([a,{x,y:a.y},{x,y:b.y},b]))
              .concat([...new Set([a.y,b.y,(a.y+b.y)/2,...baseY])].map(y=>simplify([a,{x:a.x,y},{x:b.x,y},b])));
            rails.sort((a,b)=>score(a)-score(b));chosen=rails.find(valid);
          }
          if(chosen)stats.simple++;else chosen=search(a,b,sd.x?0:1);
          result=chosen?{points:simplify([s,...chosen,e]),blocked:false}:{points:[s,a],blocked:true};
        }
        cache.set(cacheKey,result);return result;
      }
      prepared={route,rects,stats};return prepared;
    }
    return {prepare,stats};
  }
  function labelAnchor(points,rects,{width=74,height=18,offset=10,belowOffset=height+offset}={}){
    const segments=points.slice(1).map((p,i)=>({a:points[i],b:p,length:Math.abs(p.x-points[i].x)}))
      .filter(s=>s.a.y===s.b.y&&s.length>=width+8).sort((a,b)=>b.length-a.length);
    for(const s of segments){const x=(s.a.x+s.b.x)/2,baseY=s.a.y;
      for(const below of [false,true]){const y=baseY+(below?belowOffset:-offset),r={left:x-width/2,right:x+width/2,top:y-height,bottom:y+3};
        if(!rects.some(o=>r.left<o.right&&r.right>o.left&&r.top<o.bottom&&r.bottom>o.top))return {x,baseY,below};
      }
    }
    const a=points[0]||{x:0,y:0},b=points[1]||a;return {x:(a.x+b.x)/2,baseY:a.y,below:false};
  }
  return {createRouter,simplify,crosses,path,labelAnchor};
});
