/* The journal book: closed on its cover, turned by StPageFlip. The covers are hard pages (density "hard"),
   so they swing open like boards with the same engine, shading and drag as the paper pages. */
(async function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const bookEl=$('book'),wrap=$('bookwrap'),shiftEl=$('shift');
  const src=$('static'),dragnote=$('dragnote'),restart=$('restart'),nav=$('nav'),dots=$('dots');
  const reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  T.sortEntries(entries).forEach(en=>{
    const side=leftNext()?'l':'r',d=T.parseDate(en.date);
    push(T.fitText(T.entryPage(en,side)),{label:side==='l'&&d?(d.mo+'/'+d.d):null});
  });
  if(!showSamples&&contact){
    if(leftNext())push(T.blankPage('l','下一页，还空着。'));   // contact is a right-hand page
    push(contact);
  }
  if(leftNext())push(T.blankPage('l','下一页，还空着。'));     // the inside back cover is a right-hand page
  push(q('.page.inside.r'),{hard:true});
  push(q('.page.backcover'),{hard:true});

  // lay pages out once off-screen to measure line lengths for the draw-in
  const meas=T.measure();
  pages.forEach(p=>meas.appendChild(p.node));
  if(!reduced)pages.forEach(p=>{if(p.node.classList.contains('day')||p.node.classList.contains('jp'))T.prepDraw(p.node);});
  pages.forEach(p=>{
    const w=el('div','pf'+(p.hard?' hard':''));
    if(p.hard)w.dataset.density='hard';
    w.appendChild(p.node);bookEl.appendChild(w);
  });
  src.remove();
  const loading=$('loading');if(loading)loading.remove();

  /* ---------- flip ---------- */
  const pf=new St.PageFlip(bookEl,{
    width:530,height:740,size:'stretch',minWidth:240,maxWidth:600,minHeight:335,maxHeight:838,
    showCover:true,usePortrait:true,autoSize:true,drawShadow:true,maxShadowOpacity:0.45,
    flippingTime:reduced?1:1000,mobileScrollSupport:true,swipeDistance:24,showPageCorners:true,
    clickEventForward:true,startZIndex:2
  });
  pf.loadFromHTML(bookEl.querySelectorAll('.pf'));
  const last=pf.getPageCount()-1;
  const landscape=()=>pf.getOrientation()==='landscape';

  function scale(){
    const r=pf.getBoundsRect&&pf.getBoundsRect();
    if(!r||!r.pageWidth)return;
    const k=(r.pageWidth/530).toFixed(4);
    if(wrap.style.getPropertyValue('--k')!==k)wrap.style.setProperty('--k',k);
    wrap.classList.toggle('portrait',!landscape());
  }
  // shut on a cover the book is one page wide: slide it half a page so the cover sits centred
  const shiftFor=i=>!landscape()?0:i===0?-25:i>=last?25:0;
  function setShift(i){
    const v='translateX('+shiftFor(i)+'%)';
    if(shiftEl.style.transform!==v)shiftEl.style.transform=v;
    wrap.classList.toggle('closed-front',landscape()&&i===0);
    wrap.classList.toggle('closed-back',landscape()&&i>=last);
  }
  function visible(i){
    if(!landscape())return[i];
    if(i===0)return[0];
    if(i>=last)return[last];
    const l=i%2===1?i:i-1;return[l,l+1];
  }
  function reveal(i){visible(i).forEach(k=>{const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);});}
  function chrome(i){
    dragnote.hidden=i!==0||!landscape();
    restart.hidden=i<last;
    [...dots.children].forEach(b=>{
      const t=+b.dataset.page,on=t===0?i===0:(i===t||i===t+1);
      b.setAttribute('aria-current',on?'true':'false');
      if(on&&dots.scrollWidth>dots.clientWidth)dots.scrollLeft=b.offsetLeft-dots.clientWidth/2+b.offsetWidth/2;
    });
    $('prev').disabled=i===0;
    $('next').disabled=i>=last;
  }
  const chips=[{label:'封面',page:0}];
  pages.forEach((p,i)=>{if(p.label)chips.push({label:p.label,page:i});});
  chips.forEach(c=>{const b=el('button',null,c.label);b.type='button';b.dataset.page=c.page;b.onclick=()=>pf.flip(c.page);dots.appendChild(b);});

  pf.on('flip',e=>{setShift(e.data);chrome(e.data);reveal(e.data);});
  pf.on('changeState',e=>{
    const i=pf.getCurrentPageIndex();
    if(e.data==='read')setShift(i);
    // write the pages about to be uncovered while the paper is still turning, so they never pop in blank
    if(e.data==='flipping'||e.data==='user_fold'){for(let k=i-2;k<=i+3;k++){const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);}}
    // a cover starting to open: re-centre the spread as it swings. Hovering a corner ('fold_corner') must not
    // move the book, or it jumps under the pointer.
    if((e.data==='flipping'||e.data==='user_fold')&&(i===0||i>=last)){shiftEl.style.transform='translateX(0%)';dragnote.hidden=true;}
  });
  pf.on('changeOrientation',()=>{scale();setShift(pf.getCurrentPageIndex());chrome(pf.getCurrentPageIndex());});
  pf.on('update',scale);
  window.addEventListener('resize',()=>requestAnimationFrame(scale));
  new ResizeObserver(()=>scale()).observe(bookEl);
  scale();setShift(0);chrome(0);
  nav.hidden=false;

  $('prev').onclick=()=>pf.flipPrev();
  $('next').onclick=()=>pf.flipNext();
  restart.onclick=()=>pf.flip(0);
  document.addEventListener('keydown',e=>{
    if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
    if(e.key==='ArrowRight'){e.preventDefault();pf.flipNext();}
    if(e.key==='ArrowLeft'){e.preventDefault();pf.flipPrev();}
  });

  // copy e-mail
  const btn=$('copyBtn'),mailEl=$('mail');
  if(btn&&mailEl)btn.addEventListener('click',ev=>{
    ev.stopPropagation();
    const t=mailEl.textContent.trim();
    const done=()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1600);};
    const sel=()=>{const r=document.createRange();r.selectNodeContents(mailEl);const s=getSelection();s.removeAllRanges();s.addRange(r);btn.textContent='已选中，按 Ctrl+C';};
    try{navigator.clipboard.writeText(t).then(done,sel);}catch(err){sel();}
  });
})();
