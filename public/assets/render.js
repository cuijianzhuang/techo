/* Shared page renderer — used by the book (/) and the admin preview (/admin/). */
(function(){
  "use strict";
  const WD=['日','一','二','三','四','五','六'],WDE=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MOE=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sept.','Oct.','Nov.','Dec.'];

  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function parseDate(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');if(!m)return null;const y=+m[1],mo=+m[2],d=+m[3];return{y,mo,d,wd:new Date(Date.UTC(y,mo-1,d)).getUTCDay()};}
  function todayStr(){const t=new Date();return t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')+'-'+String(t.getDate()).padStart(2,'0');}
  function sortEntries(a){return a.slice().sort((x,y)=>(x.date||'').localeCompare(y.date||'')||(x.createdAt||0)-(y.createdAt||0));}

  function makeCal(y,mo,today){
    const cal=el('div','cal');cal.setAttribute('aria-hidden','true');
    '一二三四五六日'.split('').forEach(c=>cal.appendChild(el('span','h',c)));
    const first=new Date(Date.UTC(y,mo-1,1)).getUTCDay(),off=(first+6)%7,n=new Date(Date.UTC(y,mo,0)).getUTCDate();
    for(let i=0;i<off;i++)cal.appendChild(el('span'));
    for(let d=1;d<=n;d++)cal.appendChild(el('span',d===today?'t':'',String(d)));
    return cal;
  }
  function mugSvg(kind,size){
    const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg'),u=document.createElementNS(ns,'use');
    s.setAttribute('width',size);s.setAttribute('height',size);s.setAttribute('aria-hidden','true');u.setAttribute('href','#'+kind);s.appendChild(u);return s;
  }

  /* one journal page written from the admin */
  function entryPage(en,side){
    const dt=parseDate(en.date)||parseDate(todayStr());
    const p=el('div','page '+side+' jp');
    const h=el('header','head');
    const m=el('span','m');m.append(dt.mo+'月',el('br'),MOE[dt.mo-1]);
    const wd=el('span','wd'+(dt.wd===0||dt.wd===6?' we':''));wd.append(el('b',null,WD[dt.wd]),el('i',null,WDE[dt.wd]));
    const note=el('span','note');note.append(en.aside||'',el('br'),String(dt.y));
    h.append(m,el('span','d',String(dt.d)),wd,note);
    const b=el('div','body');
    if(en.stamp){const st=el('div','stamp',[...en.stamp][0]);st.style.cssText='top:0;right:4px';b.appendChild(st);}
    const jt=el('div','jt');jt.appendChild(el('h2',null,en.title||'（无题）'));
    if(en.latin)jt.appendChild(el('div','latin',en.latin));
    b.appendChild(jt);
    if(en.photoUrl||en.photoKey){
      const ph=el('figure','jph');
      const img=el('img');img.alt=en.photoCap||'';img.decoding='async';img.loading='lazy';
      img.src=en.photoUrl||('/img/'+en.photoKey);
      ph.append(el('div','tape'),img);
      if(en.photoCap)ph.appendChild(el('figcaption','cap',en.photoCap));
      b.appendChild(ph);
    }
    const tx=el('div','jtext');
    String(en.body||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).forEach(par=>tx.appendChild(el('p',null,par)));
    if(en.note){const n=el('div','label jnote',en.note);n.appendChild(el('div','tape'));tx.appendChild(n);}
    b.appendChild(tx);
    if(en.mood&&en.mood!=='none'){const g=mugSvg(en.mood==='sleep'?'mug-sleep':'mug',64);g.setAttribute('class','jmug');b.appendChild(g);}
    p.append(h,b);
    const f=el('footer','foot');
    if(side==='r')f.style.right='130px';
    if(en.quote){f.append(en.quote);if(en.quoteSrc)f.appendChild(el('small',null,'—— '+en.quoteSrc));}
    p.appendChild(f);
    if(side==='r'){p.appendChild(el('div','tab',String(dt.mo)));p.appendChild(makeCal(dt.y,dt.mo,dt.d));}
    return p;
  }
  function blankPage(side,text){
    const p=el('div','page '+side+' jp empty');
    const b=el('div','body');
    b.appendChild(mugSvg('mug-sleep',64));
    b.appendChild(el('div','hand',text||'下一页，还空着。'));
    p.appendChild(b);
    return p;
  }

  /* measuring box: pages are laid out at their natural 530×740 here */
  let meas=null;
  function measure(){
    if(!meas){meas=el('div');meas.style.cssText='position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none';document.body.appendChild(meas);}
    return meas;
  }
  function fitText(p){
    const t=p.querySelector('.jtext');if(!t)return p;
    const wasIn=p.parentNode;
    if(!wasIn||!document.body.contains(p))measure().appendChild(p);
    let fs=19;p.style.setProperty('--jfs',fs+'px');
    while(fs>13&&t.scrollHeight>t.clientHeight+1){fs--;p.style.setProperty('--jfs',fs+'px');}
    return p;
  }

  /* ---------- "written on the page" reveal, like the video ---------- */
  const STROKED='path,line,rect,circle,ellipse,polyline,polygon';
  function prepDraw(page){
    // page must be laid out (in the measuring box or visible)
    const items=[];
    page.querySelectorAll('.body svg').forEach(svg=>{
      if(svg.querySelector(':scope>use')&&svg.children.length===1){items.push({el:svg,kind:'pop'});return;}
      svg.querySelectorAll(STROKED).forEach(sh=>{
        const cs=getComputedStyle(sh);
        const hasStroke=cs.stroke&&cs.stroke!=='none'&&parseFloat(cs.strokeWidth)>0;
        const hasFill=cs.fill&&cs.fill!=='none'&&cs.fill!=='transparent'&&cs.fillOpacity!=='0';
        let len=0;if(hasStroke){try{len=sh.getTotalLength();}catch(e){len=0;}}
        if(hasStroke&&len>0&&!cs.strokeDasharray.match(/\d/)){items.push({el:sh,kind:'stroke',len,fill:hasFill});}
        else if(hasStroke||hasFill){items.push({el:sh,kind:'fade'});}
      });
      svg.querySelectorAll('text').forEach(t=>items.push({el:t,kind:'fade'}));
    });
    page.querySelectorAll('.body h2,.body .latin,.body .hand,.body .jtext,.body .label,.body .bub,.body .stamp,.body .photo,.body .jph,.body .tape,.body .check,.body .wash,.body .comic .time,.body [data-draw]').forEach(n=>{
      if(n.closest('svg'))return;
      items.push({el:n,kind:n.classList.contains('stamp')?'stamp':'text'});
    });
    // de-dup nested text nodes: keep outermost
    const set=new Set(items.map(i=>i.el));
    const final=items.filter(i=>{if(i.kind!=='text')return true;let p=i.el.parentElement;while(p&&p!==page){if(set.has(p)&&items.find(x=>x.el===p&&x.kind==='text'))return false;p=p.parentElement;}return true;});
    final.forEach(i=>{
      if(i.kind==='stroke'){i.el.style.strokeDasharray=i.len+' '+i.len;i.el.style.strokeDashoffset=String(i.len);if(i.fill)i.el.style.fillOpacity='0';}
      else if(i.kind==='fade'){i.el.style.fillOpacity='0';i.el.style.opacity='0';}
      else i.el.style.opacity='0';
    });
    page.__draw=final;page.dataset.draw='pending';
  }
  function playDraw(page){
    if(!page||page.dataset.draw!=='pending')return;
    page.dataset.draw='done';
    const items=page.__draw||[];page.__draw=null;
    const strokes=items.filter(i=>i.kind==='stroke'||i.kind==='fade'||i.kind==='pop');
    const texts=items.filter(i=>i.kind==='text'||i.kind==='stamp');
    let t=0;
    // texts in reading order, then drawing — pen goes title first like the video's captions
    const order=texts.slice(0,2).concat(strokes).concat(texts.slice(2));
    const drawDur=Math.min(1600,300+strokes.length*18);
    order.forEach((i,idx)=>{
      const el=i.el;
      if(i.kind==='stroke'){
        const d=Math.min(900,180+i.len*1.4);
        el.animate([{strokeDashoffset:i.len},{strokeDashoffset:0}],{duration:d,delay:t,easing:'ease-in-out',fill:'forwards'}).finished.then(()=>{el.style.strokeDasharray='';el.style.strokeDashoffset='';}).catch(()=>{});
        if(i.fill)el.animate([{fillOpacity:0},{fillOpacity:1}],{duration:380,delay:t+d*0.7,easing:'ease-out',fill:'forwards'}).finished.then(()=>{el.style.fillOpacity='';}).catch(()=>{});
        t+=drawDur/Math.max(strokes.length,1);
      }else if(i.kind==='fade'){
        el.animate([{opacity:0,fillOpacity:0},{opacity:1,fillOpacity:1}],{duration:420,delay:t+260,easing:'ease-out',fill:'forwards'}).finished.then(()=>{el.style.opacity='';el.style.fillOpacity='';}).catch(()=>{});
        t+=drawDur/Math.max(strokes.length,1);
      }else if(i.kind==='pop'){
        el.animate([{opacity:0},{opacity:1}],{duration:420,delay:t+120,easing:'ease-out',fill:'forwards'}).finished.then(()=>{el.style.opacity='';}).catch(()=>{});
      }else if(i.kind==='stamp'){
        el.animate([{opacity:0},{opacity:.85}],{duration:220,delay:t,easing:'ease-out',fill:'forwards'}).finished.then(()=>{el.style.opacity='';}).catch(()=>{});
        t+=120;
      }else{
        // written left-to-right: a clip wipe, no movement
        el.animate([{opacity:1,clipPath:'inset(-8px 100% -8px -8px)'},{opacity:1,clipPath:'inset(-8px -8px -8px -8px)'}],{duration:520,delay:t,easing:'linear',fill:'both'}).finished.then(a=>{el.style.opacity='';a.cancel();}).catch(()=>{});
        t+=idx<2?260:150;
      }
    });
  }

  window.Techo={el,parseDate,todayStr,sortEntries,makeCal,mugSvg,entryPage,blankPage,fitText,measure,prepDraw,playDraw};
})();
