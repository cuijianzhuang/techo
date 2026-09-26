/* The journal book: closed on its cover, turned by StPageFlip. The covers are hard pages (density "hard"),
   so they swing open like boards with the same engine, shading and drag as the paper pages. */
(async function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const bookEl=$('book'),wrap=$('bookwrap'),shiftEl=$('shift');
  const src=$('static'),dragnote=$('dragnote'),restart=$('restart'),nav=$('nav'),dots=$('dots');
  const reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* data, settings and the page list (shared with the 3D book): see Techo.loadBook in render.js */
  const {pages}=await T.loadBook(src);

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
    flippingTime:reduced?1:1000,   // keep in step with FLIP_MS and .shift's transition
    mobileScrollSupport:true,swipeDistance:24,showPageCorners:true,
    clickEventForward:true,startZIndex:2
  });
  pf.loadFromHTML(bookEl.querySelectorAll('.pf'));
  const last=pf.getPageCount()-1;

  /* StPageFlip plays a turn as a list of frames at an even pace, so a cover swung open at constant speed and
     stopped dead. Remap its clock through an ease-in-out: a turn lifts slowly, speeds up, settles. */
  const FLIP_MS=reduced?1:1000;
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;   // matches .shift's cubic-bezier(.65,0,.35,1)
  const rnd=pf.getRender(),rawRender=rnd.render.bind(rnd);
  /* StPageFlip's own hard-page shadows fall on the half a cover lands on, which is empty desk here (both are
     hidden in CSS). Instead a turning cover darkens by how far it has tilted from flat, on the page itself. */
  const hardEls=[...bookEl.querySelectorAll('.pf.hard')];
  function shadeHard(){
    for(const h of hardEls){
      const m=/rotateY\((-?[\d.]+)deg\)/.exec(h.style.transform||'');
      h.style.setProperty('--tilt',m?Math.abs(Math.sin(parseFloat(m[1])*Math.PI/180)).toFixed(3):'0');
    }
  }
  rnd.render=function(t){
    const a=this.animation;
    if(a&&a.frames&&a.frames.length>1){
      const total=a.frames.length*a.durationFrame,p=Math.min(1,Math.max(0,(t-a.startedAt)/total));
      rawRender(a.startedAt+ease(p)*total);
    }else rawRender(t);
    shadeHard();   // after StPageFlip has rewritten the pages' inline styles for this frame
  };
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
    T.dragNote(dragnote,i===0&&landscape());
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
    if(e.data==='read'){shiftEl.style.transitionDuration='';setShift(i);}
    // write the pages about to be uncovered while the paper is still turning, so they never pop in blank
    if(e.data==='flipping'||e.data==='user_fold'){for(let k=i-2;k<=i+3;k++){const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);}}
    // a cover starting to open: re-centre the spread as it swings. Hovering a corner ('fold_corner') must not
    // move the book, or it jumps under the pointer.
    // A cover turn slides the book as the cover swings: opening re-centres the spread, closing centres the
    // shut cover. Slide exactly as long as this turn lasts (StPageFlip shortens a turn with less far to go).
    // Hovering a corner ('fold_corner') must not move the book, or it jumps under the pointer.
    if(e.data==='flipping'&&landscape()){
      const fwd=rnd.getDirection()===0;                 // StPageFlip FlipDirection: 0 forward, 1 back
      const to=i===0||i>=last?0:(fwd&&i>=last-2)?25:(!fwd&&i<=2)?-25:null;
      if(to!==null){
        T.dragNote(dragnote,false);
        // the turn's animation is set up right after this event fires: read its length once it exists
        Promise.resolve().then(()=>{
          const an=rnd.animation;
          shiftEl.style.transitionDuration=an&&an.frames?Math.round(an.frames.length*an.durationFrame)+'ms':'';
          shiftEl.style.transform='translateX('+to+'%)';
        });
      }
    }
  });
  pf.on('changeOrientation',()=>{scale();setShift(pf.getCurrentPageIndex());chrome(pf.getCurrentPageIndex());});
  pf.on('update',scale);
  window.addEventListener('resize',()=>requestAnimationFrame(scale));
  new ResizeObserver(()=>scale()).observe(bookEl);
  scale();setShift(0);chrome(0);
  nav.hidden=false;

  // 放大看: the page(s) open now, big enough to read on a phone
  $('next').after(T.readerButton(()=>visible(pf.getCurrentPageIndex()).map(k=>pages[k]&&pages[k].node)));
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
