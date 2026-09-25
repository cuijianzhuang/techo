/* The journal book: closed cover by default, StPageFlip for bending-paper page turns. */
(async function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const stage=document.getElementById('stage'),bookEl=document.getElementById('book'),shiftEl=document.getElementById('shift');
  const src=document.getElementById('static');
  const dragnote=document.getElementById('dragnote'),restart=document.getElementById('restart');
  const nav=document.getElementById('nav'),dots=document.getElementById('dots');
  const reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- data: API on Cloudflare, or inline data for previews ---------- */
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
  // contact page
  const mail=src.querySelector('#mail');if(mail&&settings.email)mail.textContent=settings.email;
  const gh=src.querySelector('#gh');
  if(gh){const ok=/^https:\/\//i.test(settings.github||'');gh.href=ok?settings.github:'https://github.com/';
    gh.textContent=settings.githubText||(ok?settings.github.replace(/^https:\/\//i,''):'github.com/你的用户名');}

  // wait for handwriting fonts so text fitting measures the real glyphs
  if(document.fonts&&document.fonts.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))]);

  /* ---------- assemble pages ---------- */
  const q=s=>src.querySelector(s);
  const pages=[];            // {node, hard, label}
  const push=(node,opt)=>pages.push(Object.assign({node},opt||{}));
  push(q('.page.cover'),{hard:true});
  push(q('.page.inside.l'),{hard:true});
  push(q('.page.flyleaf'));
  const statics=[...src.querySelectorAll('.day')];
  statics.forEach((p,i)=>push(p,{label:i%2===0?p.dataset.label:null}));
  const list=T.sortEntries(entries);
  list.forEach((en,i)=>{
    const side=(pages.length%2===1)?'l':'r';
    const p=T.fitText(T.entryPage(en,side));
    const d=T.parseDate(en.date);
    push(p,{label:side==='l'&&d?(d.mo+'/'+d.d):null});
  });
  if(pages.length%2===1)push(T.blankPage('l','下一页，还空着。'));
  push(q('.page.inside.r'),{hard:true});
  push(q('.page.backcover'),{hard:true});

  // lay pages out once off-screen to measure line lengths for the draw-in
  const meas=T.measure();
  pages.forEach(p=>meas.appendChild(p.node));
  if(!reduced)pages.forEach(p=>{if(p.node.classList.contains('day')||p.node.classList.contains('jp'))T.prepDraw(p.node);});

  pages.forEach(p=>{
    const w=el('div','pf'+(p.hard?' hard':''));
    if(p.hard)w.dataset.density='hard';
    w.appendChild(p.node);
    bookEl.appendChild(w);
  });
  src.remove();
  const loading=document.getElementById('loading');if(loading)loading.remove();

  /* ---------- flip ---------- */
  const pf=new St.PageFlip(bookEl,{
    width:530,height:740,size:'stretch',minWidth:240,maxWidth:600,minHeight:335,maxHeight:838,
    showCover:true,usePortrait:true,autoSize:true,drawShadow:true,maxShadowOpacity:0.45,
    flippingTime:reduced?1:1000,mobileScrollSupport:true,swipeDistance:24,showPageCorners:true,
    clickEventForward:true,startZIndex:2
  });
  pf.loadFromHTML(bookEl.querySelectorAll('.pf'));
  const last=pf.getPageCount()-1;

  function scale(){
    const r=pf.getBoundsRect&&pf.getBoundsRect();
    if(r&&r.pageWidth){const k=(r.pageWidth/530).toFixed(4);if(bookEl.style.getPropertyValue('--k')!==k)bookEl.style.setProperty('--k',k);}
  }
  const landscape=()=>pf.getOrientation()==='landscape';
  function shiftFor(i){
    if(!landscape())return 0;
    if(i===0)return -25;
    if(i>=last)return 25;
    return 0;
  }
  function setShift(i){const v='translateX('+shiftFor(i)+'%)';if(shiftEl.style.transform!==v)shiftEl.style.transform=v;}
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
    [...dots.children].forEach(b=>{const t=+b.dataset.page;const on=t===0?i===0:(i===t||i===t+1);b.setAttribute('aria-current',on?'true':'false');if(on&&dots.scrollWidth>dots.clientWidth)dots.scrollLeft=b.offsetLeft-dots.clientWidth/2+b.offsetWidth/2;});
    document.getElementById('prev').disabled=i===0;
    document.getElementById('next').disabled=i>=last;
  }
  // date chips
  const chips=[{label:'封面',page:0}];
  pages.forEach((p,i)=>{if(p.label)chips.push({label:p.label,page:i});});
  chips.forEach(c=>{const b=el('button',null,c.label);b.type='button';b.dataset.page=c.page;b.onclick=()=>pf.flip(c.page);dots.appendChild(b);});
  if(!chips.length)dots.remove();

  pf.on('flip',e=>{setShift(e.data);chrome(e.data);reveal(e.data);});
  // Only re-centre the book once a real turn starts. Hovering a corner ('fold_corner')
  // must not move it, or the whole book jumps under the pointer.
  pf.on('changeState',e=>{
    const i=pf.getCurrentPageIndex();
    if(e.data==='read'){setShift(i);}
    // start writing the pages about to be uncovered while the paper is still turning,
    // so they never show up blank and then pop in
    if(e.data==='flipping'||e.data==='user_fold'){for(let k=i-2;k<=i+3;k++){const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);}}
    if((e.data==='flipping'||e.data==='user_fold')&&(i===0||i>=last)){shiftEl.style.transform='translateX(0%)';dragnote.hidden=true;}
  });
  pf.on('changeOrientation',()=>{scale();setShift(pf.getCurrentPageIndex());});
  pf.on('update',scale);
  window.addEventListener('resize',()=>requestAnimationFrame(scale));
  new ResizeObserver(()=>scale()).observe(bookEl);
  scale();setShift(0);chrome(0);
  nav.hidden=false;

  document.getElementById('prev').onclick=()=>pf.flipPrev();
  document.getElementById('next').onclick=()=>pf.flipNext();
  restart.onclick=()=>pf.flip(0);
  document.addEventListener('keydown',e=>{
    if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
    if(e.key==='ArrowRight')pf.flipNext();
    if(e.key==='ArrowLeft')pf.flipPrev();
  });

  // copy e-mail
  const btn=document.getElementById('copyBtn'),mailEl=document.getElementById('mail');
  if(btn&&mailEl)btn.addEventListener('click',ev=>{
    ev.stopPropagation();
    const t=mailEl.textContent.trim();
    const done=()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1600);};
    const sel=()=>{const r=document.createRange();r.selectNodeContents(mailEl);const s=getSelection();s.removeAllRanges();s.addRange(r);btn.textContent='已选中，按 Ctrl+C';};
    try{navigator.clipboard.writeText(t).then(done,sel);}catch(err){sel();}
  });
})();
