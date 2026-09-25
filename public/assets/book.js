/* The journal book.
   - Front and back covers are our own 3D boards (thickness, shading, drag to open/close).
   - The pages in between turn with StPageFlip (bending paper). */
(async function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const stage=$('stage'),bookEl=$('book'),wrap=$('bookwrap'),shiftEl=$('shift');
  const src=$('static'),dragnote=$('dragnote'),restart=$('restart'),nav=$('nav'),dots=$('dots');
  const reduced=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- data ---------- */
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
  if(document.fonts&&document.fonts.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))]);

  /* ---------- interior pages (inside covers are glued to the boards, they never turn) ---------- */
  const q=s=>src.querySelector(s);
  const coverNode=q('.page.cover'),backNode=q('.page.backcover');
  const insideFront=q('.page.inside.l'),insideBack=q('.page.inside.r');
  const pages=[];
  const push=(node,label)=>pages.push({node,label:label||null});
  push(insideFront);push(q('.page.flyleaf'));
  [...src.querySelectorAll('.day')].forEach((p,i)=>push(p,i%2===0?p.dataset.label:null));
  T.sortEntries(entries).forEach(en=>{
    const side=pages.length%2===0?'l':'r';
    const d=T.parseDate(en.date);
    push(T.fitText(T.entryPage(en,side)),side==='l'&&d?(d.mo+'/'+d.d):null);
  });
  if(pages.length%2===0)push(T.blankPage('l','下一页，还空着。'));
  push(insideBack);
  const N=pages.length;

  const meas=T.measure();
  pages.forEach(p=>meas.appendChild(p.node));
  if(!reduced)pages.forEach(p=>{if(p.node.classList.contains('day')||p.node.classList.contains('jp'))T.prepDraw(p.node);});
  pages.forEach(p=>{const w=el('div','pf');w.appendChild(p.node);bookEl.appendChild(w);});

  /* ---------- the two boards ---------- */
  function makeLeaf(cls){
    const leaf=el('div','leaf '+cls);leaf.hidden=true;
    const front=el('div','face front'),back=el('div','face back');
    front.appendChild(el('div','shade'));back.appendChild(el('div','shade'));
    leaf.append(front,back,el('div','edge'),el('div','edge top'),el('div','edge bottom'));
    wrap.appendChild(leaf);
    return {leaf,front,back,fs:front.lastChild,bs:back.lastChild};
  }
  function setFaces(L,frontNode,backNode){
    [L.front,L.back].forEach(f=>[...f.children].forEach(c=>{if(!c.classList.contains('shade')&&c!==frontNode&&c!==backNode)c.remove();}));
    if(frontNode.parentNode!==L.front)L.front.prepend(frontNode);
    if(backNode.parentNode!==L.back)L.back.prepend(backNode);
  }
  const FL=makeLeaf('front-board'),BL=makeLeaf('back-board');
  const insideFrontCopy=insideFront.cloneNode(true),insideBackCopy=insideBack.cloneNode(true);
  setFaces(FL,coverNode,insideFrontCopy);
  const under={r:el('div','undershade r'),l:el('div','undershade l')};
  wrap.append(under.r,under.l);
  src.remove();
  const loading=$('loading');if(loading)loading.remove();

  /* ---------- page flip for the interior ---------- */
  const pf=new St.PageFlip(bookEl,{
    width:530,height:740,size:'stretch',minWidth:240,maxWidth:600,minHeight:335,maxHeight:838,
    showCover:false,usePortrait:true,autoSize:true,drawShadow:true,maxShadowOpacity:0.4,
    flippingTime:reduced?1:950,mobileScrollSupport:true,swipeDistance:24,showPageCorners:true,
    clickEventForward:true,startZIndex:2
  });
  pf.loadFromHTML(bookEl.querySelectorAll('.pf'));
  const landscape=()=>pf.getOrientation()==='landscape';
  const idx=()=>pf.getCurrentPageIndex();
  const atStart=()=>idx()<=1;
  const atEnd=()=>idx()>=N-2;

  function scale(){
    const r=pf.getBoundsRect&&pf.getBoundsRect();
    if(!r||!r.pageWidth)return;
    const k=(r.pageWidth/530).toFixed(4);
    if(wrap.style.getPropertyValue('--k')!==k)wrap.style.setProperty('--k',k);
    // gentle perspective: the lifting board should not balloon over the page
    wrap.style.setProperty('--persp',Math.round(r.pageWidth*(landscape()?16:10))+'px');
    wrap.classList.toggle('portrait',!landscape());
  }

  /* ---------- cover state machine ---------- */
  // mode: 'front' (closed on the cover) | 'open' | 'back' (closed on the back cover) | 'anim'
  let mode='front';
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

  function boardFor(which){
    if(which==='front'){setFaces(FL,coverNode,insideFrontCopy);return FL;}
    // back board: landscape lies on the right showing the inside; portrait shows the back cover itself
    if(landscape())setFaces(BL,insideBackCopy,backNode);else setFaces(BL,backNode,insideBackCopy);
    return BL;
  }
  function paint(which,p){
    const L=which==='front'?FL:BL,land=landscape();
    const angle=(which==='front'||!land)?180*p:180*(1-p);
    const lift=Math.sin(angle*Math.PI/180);
    L.leaf.style.transform='rotateY('+(-angle).toFixed(2)+'deg)';
    L.fs.style.opacity=angle<90?(0.42*lift).toFixed(3):'0';
    L.bs.style.opacity=angle>=90?(0.34*lift).toFixed(3):'0';
    L.leaf.style.opacity=(!land&&angle>120)?Math.max(0,(180-angle)/60).toFixed(3):'1';
    // shadow thrown on the page the board is lifting from / landing on
    under.r.style.opacity=under.l.style.opacity='0';
    const us=land&&which==='back'?under.l:under.r;
    // darkest while the board is still close over the page, gone once it lies open
    us.style.opacity=(0.9*(1-p)*(land?1:0.6)).toFixed(3);
    // slide the whole book so whatever lies on the desk stays centred
    const shift=land?(which==='front'?-25*(1-p):25*(1-p)):0;
    shiftEl.style.transform='translateX('+shift.toFixed(3)+'%)';
  }
  function settle(which,p){
    const L=which==='front'?FL:BL;
    under.r.style.opacity=under.l.style.opacity='0';
    wrap.classList.remove('closed-front','closed-back','shut');
    if(p===1){
      FL.leaf.hidden=BL.leaf.hidden=true;
      mode='open';shiftEl.style.transform='translateX(0%)';
      reveal(idx());
    }else{
      mode=which;L.leaf.hidden=false;
      // 'shut': the board lies flat on the pages, so hide them; otherwise the paper peeks out round its corners
      wrap.classList.add(which==='front'?'closed-front':'closed-back','shut');
      paint(which,0);
    }
    chrome();
  }
  function begin(which){
    const L=boardFor(which);
    (which==='front'?BL:FL).leaf.hidden=true;
    L.leaf.hidden=false;mode='anim';
    // keep the half the board swings away from hidden until the board has landed
    wrap.classList.remove('closed-front','closed-back','shut');
    wrap.classList.add(which==='front'?'closed-front':'closed-back');
    dragnote.hidden=true;
    return L;
  }
  function animateTo(which,from,to,dur,after){
    begin(which);
    if(reduced)dur=1;
    const t0=performance.now();
    return new Promise(res=>{
      function f(now){
        const t=Math.min(1,(now-t0)/dur),p=from+(to-from)*ease(t);
        paint(which,p);
        if(t<1)requestAnimationFrame(f);else{settle(which,to);if(after)after();res();}
      }
      requestAnimationFrame(f);
    });
  }
  const openFront=()=>{if(mode==='front')animateTo('front',0,1,1150);};
  const closeFront=()=>{if(mode==='open')animateTo('front',1,0,1050);};
  const openBack=()=>{if(mode==='back')animateTo('back',0,1,1150);};
  const closeBack=()=>{if(mode==='open')animateTo('back',1,0,1050);};

  /* drag a board: it follows the pointer; release past halfway (or with a flick) to finish */
  function startDrag(which,e,fromP){
    begin(which);paint(which,fromP);
    const w=wrap.getBoundingClientRect().width*(landscape()?0.9:0.7);
    const dir=(which==='back'&&landscape())?1:-1;       // which way the pointer moves to OPEN
    const x0=e.clientX;let lastX=x0,lastT=performance.now(),v=0,moved=false,p=fromP;
    const move=ev=>{
      const dx=ev.clientX-x0;if(Math.abs(dx)>4)moved=true;
      p=Math.max(0,Math.min(1,fromP+dir*dx/w));
      const now=performance.now();v=(ev.clientX-lastX)/Math.max(1,now-lastT)*dir;lastX=ev.clientX;lastT=now;
      paint(which,p);
    };
    const up=()=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
      let to;
      if(!moved)to=fromP>0.5?0:1;                        // a tap toggles
      else if(v>0.5)to=1;else if(v<-0.5)to=0;else to=p>0.5?1:0;
      animateTo(which,p,to,Math.max(280,Math.abs(to-p)*1150));
    };
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  }
  [FL,BL].forEach(L=>L.leaf.addEventListener('pointerdown',e=>{
    if(mode==='anim'||mode==='open'||e.button>0)return;
    e.preventDefault();
    startDrag(L===FL?'front':'back',e,0);
  }));
  // grabbing the outer edge of the first/last spread closes the book, like lifting a board
  let edgeGrab=false;
  wrap.addEventListener('pointerdown',e=>{
    edgeGrab=false;
    if(mode!=='open'||!landscape()||e.button>0)return;
    const r=wrap.getBoundingClientRect(),x=(e.clientX-r.left)/r.width;
    if(atStart()&&x<0.08){edgeGrab=true;e.preventDefault();startDrag('front',e,1);}
    else if(atEnd()&&x>0.92){edgeGrab=true;e.preventDefault();startDrag('back',e,1);}
  },true);
  ['mousedown','touchstart'].forEach(t=>wrap.addEventListener(t,e=>{if(edgeGrab)e.stopPropagation();},true));

  /* ---------- navigation ---------- */
  let pending=null;
  function goPrev(){
    if(mode==='back')return openBack();
    if(mode!=='open')return;
    if(atStart())return closeFront();
    pf.flipPrev();
  }
  function goNext(){
    if(mode==='front')return openFront();
    if(mode!=='open')return;
    if(atEnd())return closeBack();
    pf.flipNext();
  }
  function visible(i){
    if(!landscape())return[i];
    const l=i-(i%2);return[l,l+1];
  }
  function reveal(i){visible(i).forEach(k=>{const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);});}

  const chips=[{label:'封面',page:-1}];
  pages.forEach((p,i)=>{if(p.label)chips.push({label:p.label,page:i});});
  chips.forEach(c=>{
    const b=el('button',null,c.label);b.type='button';b.dataset.page=c.page;
    b.onclick=()=>{
      if(c.page<0){
        if(mode==='back'){instantFront();return;}
        if(mode!=='open')return;
        if(atStart())closeFront();else{pending='close';pf.flip(landscape()?0:1);}
        return;
      }
      const go=()=>pf.flip(c.page);
      if(mode==='front')animateTo('front',0,1,1150,go);
      else if(mode==='back')animateTo('back',0,1,1150,go);
      else if(mode==='open')go();
    };
    dots.appendChild(b);
  });
  function chrome(){
    const i=idx();
    dragnote.hidden=!(mode==='front'&&landscape());
    restart.hidden=mode!=='back';
    [...dots.children].forEach(b=>{
      const t=+b.dataset.page;
      const on=t<0?mode==='front':(mode==='open'&&(landscape()?(i-(i%2)===t):(i===t||i===t+1)));
      b.setAttribute('aria-current',on?'true':'false');
      if(on&&dots.scrollWidth>dots.clientWidth)dots.scrollLeft=b.offsetLeft-dots.clientWidth/2+b.offsetWidth/2;
    });
    $('prev').disabled=mode==='front';
    $('next').disabled=mode==='back';
  }
  function instantFront(){
    stage.animate([{opacity:1},{opacity:0}],{duration:180,fill:'forwards'}).finished.then(a=>{
      pf.turnToPage(landscape()?0:1);
      BL.leaf.hidden=true;boardFor('front');settle('front',0);
      a.cancel();stage.animate([{opacity:0},{opacity:1}],{duration:260});
    });
  }

  pf.on('flip',e=>{
    if(pending==='close'&&atStart()){pending=null;closeFront();}
    chrome();reveal(e.data);
  });
  pf.on('changeState',e=>{
    if(e.data==='flipping'||e.data==='user_fold'){
      const i=idx();for(let k=i-2;k<=i+3;k++){const n=pages[k]&&pages[k].node;if(n)T.playDraw(n);}
    }
  });
  pf.on('changeOrientation',()=>{
    scale();
    if(mode==='front'){if(!landscape()&&idx()<1)pf.turnToPage(1);boardFor('front');paint('front',0);}
    if(mode==='back'){boardFor('back');paint('back',0);}
    chrome();
  });
  window.addEventListener('resize',()=>requestAnimationFrame(scale));
  new ResizeObserver(()=>scale()).observe(bookEl);

  $('prev').onclick=goPrev;
  $('next').onclick=goNext;
  restart.onclick=instantFront;
  document.addEventListener('keydown',e=>{
    if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
    if(e.key==='ArrowRight'){e.preventDefault();goNext();}
    if(e.key==='ArrowLeft'){e.preventDefault();goPrev();}
  });

  // start closed on the front cover
  scale();
  if(!landscape())pf.turnToPage(1);
  boardFor('front');settle('front',0);
  nav.hidden=false;

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
