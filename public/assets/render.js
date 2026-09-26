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

  /* hand-drawn doodles a page can carry (max 2). Inline, not <use>, so the reveal draws them stroke by stroke.
     Keep the names in sync with STICKERS in src/index.ts. */
  const INK='#2a2724',RED='#d9573b',TEAL='#6a98a3',TEALD='#3f6f7c',CREAM='#f2e3b0',KRAFT='#e4d2a3',OLIVE='#8a9a2b',LIME='#b3c01c',PINK='#f3a08a',GREY='#9aa7aa';
  const STICKERS={
    sun:['晴天',`<circle cx="32" cy="32" r="12" fill="${CREAM}"/><path d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M15 49l6-6M43 21l6-6" stroke="${RED}"/><circle cx="28" cy="31" r="1.6" fill="${INK}" stroke="none"/><circle cx="36" cy="31" r="1.6" fill="${INK}" stroke="none"/><path d="M28.5 36q3.5 3 7 0"/>`],
    cloud:['多云',`<path d="M16 46h31a10 10 0 0 0 0-20a14 14 0 0 0-27-3a12 12 0 0 0-4 23z" fill="#fff"/><path d="M26 38q3 2 6 0" stroke="${GREY}"/>`],
    rain:['下雨',`<path d="M16 38h31a10 10 0 0 0 0-20a14 14 0 0 0-27-3a12 12 0 0 0-4 23z" fill="#dbe8ea"/><path d="M22 45l-3 7M33 45l-3 7M44 45l-3 7" stroke="${TEALD}"/><path d="M27.5 55l-2 4M38.5 55l-2 4" stroke="${TEAL}"/>`],
    moon:['月亮',`<path d="M38 8a22 22 0 1 0 14 37A18 18 0 0 1 38 8z" fill="${CREAM}"/><path d="M27 34q3 2.4 6 0"/><path d="M50 12v8M46 16h8M55 30v5M52.5 32.5h5" stroke="${OLIVE}"/>`],
    cat:['猫',`<path d="M14 28l2-15 11 8h10l11-8 2 15c3 5 3 11 0 15-4 7-11 10-18 10s-14-3-18-10c-3-4-3-10 0-15z" fill="${KRAFT}"/><circle cx="25" cy="35" r="2.2" fill="${INK}" stroke="none"/><circle cx="39" cy="35" r="2.2" fill="${INK}" stroke="none"/><path d="M30 40h4l-2 2.4z" fill="${PINK}" stroke="none"/><path d="M32 42.5q-2 3-5 1.5M32 42.5q2 3 5 1.5"/><path d="M6 38l10 2M7 45l9-2M58 38l-10 2M57 45l-9-2" stroke="${GREY}" stroke-width="1.6"/>`],
    book:['书',`<path d="M32 18c-6-4-14-5-22-4v34c8-1 16 0 22 4c6-4 14-5 22-4V14c-8-1-16 0-22 4z" fill="#fff"/><path d="M32 18v34"/><path d="M15 23c5 0 9 1 12 2M15 30c5 0 9 1 12 2M15 37c5 0 9 1 12 2M37 30c3-1 7-2 12-2M37 37c3-1 7-2 12-2" stroke="${GREY}" stroke-width="1.8"/><path d="M40 16v10l3-2.4 3 2.4V15" fill="${RED}"/>`],
    laptop:['电脑',`<rect x="13" y="14" width="38" height="26" rx="2.5" fill="#1f292d"/><path d="M7 44h50l-4 7H11z" fill="${KRAFT}"/><path d="M19 22h9M19 28h16M23 34h8" stroke="#c9d77a" stroke-width="2"/><path d="M36 34h4" stroke="${PINK}" stroke-width="2"/>`],
    bug:['bug',`<path d="M29 13l-4-6M35 13l4-6M21 29l-9-4M20 37h-10M21 45l-8 5M43 29l9-4M44 37h10M43 45l8 5"/><circle cx="32" cy="18" r="6" fill="${INK}"/><ellipse cx="32" cy="37" rx="12" ry="15" fill="${RED}"/><path d="M32 23v29"/><circle cx="26" cy="33" r="2" fill="${INK}" stroke="none"/><circle cx="38" cy="41" r="2" fill="${INK}" stroke="none"/><circle cx="37" cy="30" r="1.6" fill="${INK}" stroke="none"/>`],
    plant:['植物',`<path d="M32 38V20" stroke="${OLIVE}"/><path d="M32 29c-10 0-14-7-14-14c8 0 14 4 14 14z" fill="${OLIVE}"/><path d="M32 23c1-9 8-14 16-13c0 8-6 13-16 13z" fill="${LIME}"/><path d="M17 37h30v6H17z" fill="${KRAFT}"/><path d="M20 43h24l-3 14H23z" fill="${RED}"/>`],
    noodles:['吃面',`<path d="M36 6l16 24M43 5l12 23" stroke="#b98a4a" stroke-width="3"/><path d="M21 34c0-6 4-7 4-13M29 34c0-6 4-7 4-13M37 34c0-6 4-7 4-13" stroke="#e2b75a" stroke-width="2.6"/><path d="M9 34h46c0 12-10 20-23 20S9 46 9 34z" fill="#fff"/><path d="M15 42h34" stroke="${RED}" stroke-dasharray="0.1 5" stroke-width="3"/>`],
    bus:['公交',`<rect x="12" y="10" width="40" height="40" rx="7" fill="${TEAL}"/><rect x="17" y="16" width="30" height="14" rx="2" fill="#fff"/><path d="M12 35h40"/><circle cx="20" cy="42" r="3" fill="${CREAM}"/><circle cx="44" cy="42" r="3" fill="${CREAM}"/><path d="M18 51v4M46 51v4" stroke-width="5"/>`],
    bike:['骑车',`<circle cx="17" cy="42" r="10" fill="#fff"/><circle cx="47" cy="42" r="10" fill="#fff"/><path d="M17 42l9-16h15l6 16M26 26l7 16h14M22 20h9M41 26l-2-7h6" stroke="${RED}"/><circle cx="33" cy="42" r="2" fill="${INK}" stroke="none"/>`],
    music:['音乐',`<path d="M24 46V17l24-6v30"/><path d="M24 24l24-6" stroke-width="3"/><ellipse cx="19" cy="46" rx="6" ry="4.5" fill="${INK}" transform="rotate(-18 19 46)"/><ellipse cx="43" cy="41" rx="6" ry="4.5" fill="${INK}" transform="rotate(-18 43 41)"/><path d="M8 20q3-3 6 0M52 52q3-3 6 0" stroke="${TEAL}"/>`],
    heart:['心',`<path d="M32 53C14 41 9 31 11 23c2-9 13-11 21-3c8-8 19-6 21 3c2 8-3 18-21 30z" fill="${PINK}"/><path d="M19 24q2-5 7-5" stroke="#fff" stroke-width="2.4"/>`],
    star:['星星',`<path d="M30 7c2 12 6 16 18 18c-12 2-16 6-18 18c-2-12-6-16-18-18c12-2 16-6 18-18z" fill="${CREAM}"/><path d="M50 40c1 5 2 6 6 7c-4 1-5 2-6 7c-1-5-2-6-6-7c4-1 5-2 6-7z" fill="${LIME}"/><path d="M13 49v5M10.5 51.5h5" stroke="${OLIVE}"/>`],
    letter:['来信',`<rect x="9" y="17" width="46" height="32" rx="2.5" fill="#fff"/><path d="M10 19l22 17 22-17"/><path d="M10 48l16-13M54 48L38 35" stroke="${GREY}" stroke-width="1.6"/><rect x="42" y="21" width="8" height="9" fill="${RED}" stroke="none"/>`],
    camera:['拍照',`<path d="M22 19l4-6h12l4 6"/><rect x="9" y="19" width="46" height="31" rx="4" fill="${KRAFT}"/><circle cx="32" cy="35" r="10" fill="#fff"/><circle cx="32" cy="35" r="4.5" fill="${TEAL}"/><rect x="45" y="23" width="6" height="3.5" fill="${RED}" stroke="none"/>`],
  };
  function stickerSvg(name,size){
    const s=STICKERS[name];if(!s)return null;
    const w=document.createElement('div');
    w.innerHTML=`<svg class="stk" data-stk="${name}" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s[1]}</svg>`;
    return w.firstChild;
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
    const stk=(Array.isArray(en.stickers)?en.stickers:String(en.stickers||'').split(',')).filter(k=>STICKERS[k]).slice(0,2);
    if(stk.length){
      const row=el('div','jstk'+(en.mood&&en.mood!=='none'?' by-mug':''));
      stk.forEach(k=>row.appendChild(stickerSvg(k,62)));
      b.appendChild(row);
    }
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
    // doodles give a little hop once the pen has finished with them
    if(page.querySelector('.jstk'))setTimeout(()=>page.classList.add('inked'),drawDur+900);
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


  /* The book's content, shared by the page-flip book (book.js) and the 3D book (book3d.js): data (inlined by the
     Worker as TECHO_DATA, or fetched), the owner's 手帐设置 applied to the built-in pages in `src`, fonts ready,
     and the page list in reading order. */
  async function loadBook(src){
    /* ---------- data: inlined by the Worker, or fetched ---------- */
    let entries=[],settings={};
    if(window.TECHO_DATA){entries=window.TECHO_DATA.entries||[];settings=window.TECHO_DATA.settings||{};}
    else{
      try{
        const [e,s]=await Promise.all([
          fetch('/api/entries',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():{entries:[]}),
          fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():{settings:{}})
        ]);
        entries=e.entries||[];settings=s.settings||{};
      }catch(err){console.warn('techo: API unavailable, showing built-in pages only',err);}
    }
    const mail=src.querySelector('#mail');if(mail&&settings.email)mail.textContent=settings.email;
    const gh=src.querySelector('#gh');
    if(gh){const ok=/^https:\/\//i.test(settings.github||'');gh.href=ok?settings.github:'https://github.com/';
      gh.textContent=settings.githubText||(ok?settings.github.replace(/^https:\/\//i,''):'github.com/你的用户名');}
    applySettings(settings);
    // wait for the handwriting fonts so text fitting measures the real glyphs
    if(document.fonts&&document.fonts.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))]);

    /* the book's own words and pictures, from the admin's 手帐设置. Missing keys keep the built-in page. */
    function applySettings(S){
      const has=k=>typeof S[k]==='string',one=s=>src.querySelector(s),list=v=>v.split(',').filter(Boolean);
      if(has('siteTitle')&&S.siteTitle)document.title=S.siteTitle;
      const deb=one('.cover .deboss');
      if(deb&&has('coverTitle')){
        // the first "." is the lime dot of cui.log
        const t=S.coverTitle,i=t.indexOf('.');deb.textContent='';
        if(i<0)deb.textContent=t;else deb.append(t.slice(0,i),el('span',null,'.'),t.slice(i+1));
      }
      const sub=one('.cover .sub');
      if(sub&&has('coverSub')){sub.textContent=S.coverSub;sub.appendChild(el('span','cursor'));}
      if(has('coverHide'))list(S.coverHide).forEach(k=>{const n=one('.cover .s-'+k);if(n)n.remove();});
      if(has('coverPhotos')){
        const cover=one('.page.cover');
        list(S.coverPhotos).slice(0,4).forEach((key,i)=>{
          const st=el('div','sticker s-photo s-photo'+i),img=el('img');
          img.src='/img/'+key;img.alt='';img.decoding='async';
          st.appendChild(img);cover.appendChild(st);
        });
      }
      const pre=one('.flyleaf pre');
      if(pre&&has('readmeName')){
        const $p=()=>el('span','p','$'),line=(...xs)=>{pre.append(...xs,'\n');};
        pre.textContent='';
        line($p(),' whoami');line(el('span','h',S.readmeName));
        line($p(),' cat role');line(S.readmeRole);
        line($p(),' ls ~/life');line(S.readmeLife);
        pre.append($p(),' git log --since='+S.readmeSince+' ',el('span','c','# 从这里开始记'));
      }
      const sig=one('.flyleaf .sig');
      if(sig&&has('readmeSign')){[...sig.childNodes].forEach(n=>{if(n.nodeType===3)n.remove();});sig.append(S.readmeSign);}
      const eof=one('.backcover .eof');if(eof&&has('backTitle'))eof.textContent=S.backTitle;
      const imp=one('.backcover .imprint');
      if(imp&&has('backImprint')){imp.textContent='';S.backImprint.split('\n').forEach((l,i)=>{if(i)imp.appendChild(el('br'));imp.append(l);});}
    }

    /* ---------- pages ---------------------------------------------------------------------------
       0 cover (hard, alone on the right) | 1 inside front (hard) + 2 flyleaf | days | entries | … |
       inside back (hard) | back cover (hard, alone on the left). With showCover, odd indexes are left-hand pages. */
    const q=s=>src.querySelector(s);
    const pages=[];            // {node, hard, label}
    const push=(node,opt)=>pages.push(Object.assign({node},opt||{}));
    const leftNext=()=>pages.length%2===1;
    push(q('.page.cover'),{hard:true});
    push(q('.page.inside.l'),{hard:true});
    push(q('.page.flyleaf'));
    // the hand-made sample pages can be hidden; their last page (写信给我, the contact details) then moves to the end
    const days=[...src.querySelectorAll('.day')],showSamples=settings.samples!=='hide';
    const contact=days.find(p=>p.querySelector('#mail'));
    if(showSamples)days.forEach((p,i)=>push(p,{label:i%2===0?p.dataset.label:null}));
    sortEntries(entries).forEach(en=>{
      const side=leftNext()?'l':'r',d=parseDate(en.date);
      push(fitText(entryPage(en,side)),{label:side==='l'&&d?(d.mo+'/'+d.d):null});
    });
    if(!showSamples&&contact){
      if(leftNext())push(blankPage('l','下一页，还空着。'));   // contact is a right-hand page
      push(contact);
    }
    if(leftNext())push(blankPage('l','下一页，还空着。'));     // the inside back cover is a right-hand page
    push(q('.page.inside.r'),{hard:true});
    push(q('.page.backcover'),{hard:true});
    return {pages,settings};
  }
  const stickerList=Object.keys(STICKERS).map(k=>({key:k,label:STICKERS[k][0]}));
  window.Techo={loadBook,stickerList,stickerSvg,el,parseDate,todayStr,sortEntries,makeCal,mugSvg,entryPage,blankPage,fitText,measure,prepDraw,playDraw};
})();
