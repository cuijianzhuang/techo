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
  /* ---------- locks: the keys this tab holds (scope → token from /api/unlock), kept until it closes ---------- */
  const KEYS='techo-keys';
  function keys(){try{return JSON.parse(sessionStorage.getItem(KEYS)||'{}')||{};}catch(e){return {};}}
  function setKeys(k){try{if(Object.keys(k).length)sessionStorage.setItem(KEYS,JSON.stringify(k));else sessionStorage.removeItem(KEYS);}catch(e){}}
  // the note in the head's corner: the page's aside, where it was written and the weather, the year
  function dateHead(dt,aside,en){
    const h=el('header','head');
    const m=el('span','m');m.append(dt.mo+'月',el('br'),MOE[dt.mo-1]);
    const wd=el('span','wd'+(dt.wd===0||dt.wd===6?' we':''));wd.append(el('b',null,WD[dt.wd]),el('i',null,WDE[dt.wd]));
    const note=el('span','note');
    const pw=en?[en.place,en.weather].filter(Boolean).join(' · '):'';
    [aside,pw].filter(Boolean).forEach(t=>note.append(t,el('br')));
    if(!aside&&!pw)note.appendChild(el('br'));
    note.append(String(dt.y));
    if(en&&en.geo){const [la,lo]=en.geo.split(',').map(Number);note.title=Math.abs(la)+'°'+(la<0?'S':'N')+' '+Math.abs(lo)+'°'+(lo<0?'W':'E');}
    h.append(m,el('span','d',String(dt.d)),wd,note);
    return h;
  }
  /* a page behind a lock: only its date, and a sealed envelope asking for the password */
  const SEAL='<svg width="150" height="104" viewBox="0 0 150 104" aria-hidden="true"><rect x="3" y="3" width="144" height="98" rx="4" fill="#fffdf6" stroke="#2a2724" stroke-width="2.4"/><path d="M4 5 75 58 146 5" fill="none" stroke="#b9b3a3" stroke-width="1.6"/><path d="M4 100 60 50M146 100 90 50" fill="none" stroke="#d8d2c2" stroke-width="1.2"/><circle cx="75" cy="58" r="17" fill="#d9573b"/><circle cx="75" cy="58" r="12.5" fill="none" stroke="#fbe3dc" stroke-width="1.2" stroke-dasharray="2 2.4"/><rect x="69" y="56" width="12" height="9" rx="1.6" fill="#fbe3dc"/><path d="M71.5 56v-3a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="#fbe3dc" stroke-width="1.8"/></svg>';
  function lockedPage(en,side){
    const dt=parseDate(en.date)||parseDate(todayStr());
    const book=en.locked==='book';
    const p=el('div','page '+side+' jp locked');
    const b=el('div','body');
    const box=el('div','seal');
    const art=el('div','seal-art');art.innerHTML=SEAL;
    box.append(art,el('div','seal-t',book?'这本手帐上了锁':'这一页上了锁'),
      el('div','seal-s',book?'在封面输入口令，整本都能看':'只给知道口令的人看'));
    const btn=el('button','lockbtn','输入口令');btn.type='button';
    btn.dataset.scope=book?'book':(en.scope||en.id);btn.dataset.date=en.date;
    box.appendChild(btn);b.appendChild(box);
    p.append(dateHead(dt,''),b,el('footer','foot'));
    if(side==='r'){p.appendChild(el('div','tab',String(dt.mo)));p.appendChild(makeCal(dt.y,dt.mo,dt.d));}
    return p;
  }
  /* the password slip: a scrap of paper in the middle of the screen; right → keep the key, reopen the book
     there (the reloaded book asks the Worker for the opened pages) */
  let asking=null;
  function askUnlock(scope,date){
    if(asking)return;
    const back=el('div','lockask-back'),card=el('form','lockask');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
    const d=parseDate(date);
    card.append(el('div','la-t','输入口令'),el('div','la-s',scope==='book'?'打开整本手帐':d?('打开 '+d.mo+' 月 '+d.d+' 日 这一页'):'打开这一页'));
    const inp=el('input');inp.type='password';inp.autocomplete='current-password';inp.maxLength=128;inp.setAttribute('aria-label','口令');
    const err=el('div','la-err');err.setAttribute('role','alert');
    const row=el('div','la-row'),ok=el('button','la-ok','打开'),no=el('button','la-no','算了');ok.type='submit';no.type='button';
    row.append(no,ok);card.append(inp,err,row,el('div','la-forget','忘了口令？翻到最后一页写信给我'));back.appendChild(card);document.body.appendChild(back);
    asking=back;
    const close=()=>{back.remove();asking=null;document.removeEventListener('keydown',esc);};
    const esc=e=>{if(e.key==='Escape')close();};
    document.addEventListener('keydown',esc);
    back.addEventListener('pointerdown',e=>{if(e.target===back)close();});
    no.onclick=close;
    card.onsubmit=async e=>{
      e.preventDefault();if(!inp.value)return;
      ok.disabled=true;err.textContent='';
      try{
        const r=await fetch('/api/unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope,password:inp.value})});
        const j=await r.json().catch(()=>({}));
        if(!r.ok||!j.token){err.textContent=j.error||'没打开，稍后再试';card.classList.remove('shake');void card.offsetWidth;card.classList.add('shake');inp.select();return;}
        const k=keys();k[scope]=j.token;setKeys(k);
        // reopen at this day (the whole book: where the reader is)
        if(date&&scope!=='book')history.replaceState(null,'',location.pathname+location.search+'#'+date);
        location.reload();
      }catch(x){err.textContent='网络不通，稍后再试';}
      finally{ok.disabled=false;}
    };
    setTimeout(()=>inp.focus(),30);
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('.lockbtn');
    if(b){e.preventDefault();e.stopPropagation();askUnlock(b.dataset.scope,b.dataset.date);}
  },true);
  /* lock again: forget this tab's keys */
  function relock(){setKeys({});history.replaceState(null,'',location.pathname+location.search);location.reload();}

  /* a page's photos: [{key, cap, url}] (url: a photo still being uploaded in the admin); older pages have
     just photoKey / photoCap */
  function photosOf(en){
    if(Array.isArray(en.photos)&&en.photos.length)return en.photos.filter(ph=>ph&&(ph.key||ph.url)).slice(0,3);
    return en.photoKey||en.photoUrl?[{key:en.photoKey,cap:en.photoCap,url:en.photoUrl}]:[];
  }

  /* ---------- the words of a page: Markdown, set in the journal's hand ----------
     Blocks: # / ## / ### headings, - lists, 1. lists, - [ ] / - [x] checklists (ticked in red), > quotes (a
     slip of paper taped on), ``` code ```, --- a dashed rule, and paragraphs (a line break stays a line
     break, as in a diary). Inline: **bold**, *italic*, ~~struck~~, `code`, [text](https://…) and ==marked==.
     One addition from the sample pages: @09:10 站会：今天修什么？ #laptop lines make a comic strip (the time and
     what, a speech bubble, up to two doodles). Built from text nodes only: nothing written is read as HTML,
     and links go to http(s) addresses only. Each block is written in by the pen on its own (prepDraw). */
  const INLINE=[
    ['code',/`([^`\n]+)`/],
    ['link',/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/],
    ['strong',/\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/],
    ['del',/~~([^~\n]+?)~~/],
    ['hl',/==([^=\n]+?)==/],
    ['em',/\*([^*\n]+?)\*/],
  ];
  function inline(text,into){
    text=String(text);
    while(text){
      let best=null;
      for(const [kind,re] of INLINE){const m=re.exec(text);if(m&&(!best||m.index<best.m.index))best={kind,m};}
      if(!best){into.append(text);break;}
      const {kind,m}=best;
      if(m.index)into.append(text.slice(0,m.index));
      const inner=m[1]!=null?m[1]:m[2];
      if(kind==='code')into.appendChild(el('code','jc',inner));
      else if(kind==='link'){const a=el('a','ln');a.href=m[2];a.target='_blank';a.rel='noopener noreferrer';into.appendChild(inline(inner,a));}
      else into.appendChild(inline(inner,el(kind==='hl'?'span':kind,kind==='hl'?'hl':null)));
      text=text.slice(m.index+m[0].length);
    }
    return into;
  }
  /* the words without their marks, for a line of them somewhere else (the timeline page) */
  function plainText(md){
    return String(md||'').replace(/```[\s\S]*?```/g,' ').replace(/^\s*(#{1,3}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|[@＠]\d{1,2}[:：]\d{2}\s*)/gm,'')
      .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/(\*\*|__|~~|==|`|\*)/g,'').replace(/[#＃][a-z]+/g,'').replace(/\s+/g,' ').trim();
  }
  function panel(time,rest){
    // "站会：今天修什么？ #laptop" → what "站会", said "今天修什么？", doodle laptop
    const doodles=[];
    rest=rest.replace(/[#＃]([a-z]+)/g,(m,k)=>{if(STICKERS[k]&&doodles.length<2){doodles.push(k);return '';}return m;}).trim();
    const m=/^([^：:]{1,12})[：:]\s*(.*)$/.exec(rest);
    const what=m?m[1].trim():'',said=m?m[2].trim():rest;
    const box=el('div','panel'+(doodles.length?' drawn':''));
    box.appendChild(el('span','time',time.replace('：',':')+(what?' · '+what:'')));
    doodles.forEach(k=>box.appendChild(stickerSvg(k,doodles.length>1?40:50)));
    if(said)box.appendChild(inline(said,el('div','bub')));
    return box;
  }
  const BLOCKS=[
    ['fence',/^\s*```/],
    ['h',/^\s*(#{1,3})\s+(.+)$/],
    ['hr',/^\s*([-*_])(\s*\1){2,}\s*$/],
    ['check',/^\s*(?:[-*+]\s+)?\[( |x|X|✓|√)\]\s+(.*)$/],
    ['ul',/^\s*[-*+•]\s+(.*)$/],
    ['ol',/^\s*(\d{1,3})[.)、]\s+(.*)$/],
    ['quote',/^\s*[>＞]\s?(.*)$/],
    ['panel',/^\s*[@＠](\d{1,2}[:：]\d{2})\s*(.*)$/],
  ];
  function bodyBlocks(body,into){
    const lines=String(body||'').replace(/\r\n?/g,'\n').split('\n');
    let run=null;                              // the block lines are going into: {kind, node}
    const open=(kind,node)=>{run={kind,node,n:0};into.appendChild(node);return node;};
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(!line.trim()){run=null;continue;}     // an empty line ends whatever block this was
      let kind='p',m=null;
      for(const [k,re] of BLOCKS){m=re.exec(line);if(m){kind=k;break;}}
      if(kind==='fence'){
        const code=[];
        while(++i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i]);
        const pre=open('code',el('pre','jcode'));pre.appendChild(el('code',null,code.join('\n')));run=null;continue;
      }
      if(kind==='h'){open('h',inline(m[2].trim(),el('div','jh jh'+m[1].length)));run=null;continue;}
      if(kind==='hr'){open('hr',el('div','jhr'));run=null;continue;}
      if(!run||run.kind!==kind){
        const node=kind==='check'?el('ul','check'):kind==='ul'?el('ul','jul'):kind==='ol'?el('ol','jol'):
          kind==='quote'?el('div','label jnote'):kind==='panel'?el('div','jcomic'):el('p');
        open(kind,node);
        if(kind==='quote')node.appendChild(el('div','tape'));
        if(kind==='ol'&&m[1]!=='1')node.start=+m[1];
      }
      if(kind==='check'){const li=inline(m[2],el('li'));if(m[1]!==' ')li.className='done';run.node.appendChild(li);}
      else if(kind==='ul'||kind==='ol')run.node.appendChild(inline(kind==='ul'?m[1]:m[2],el('li')));
      else if(kind==='panel')run.node.appendChild(panel(m[1],m[2]));
      else{
        if(run.n)run.node.appendChild(el('br'));
        inline(kind==='quote'?m[1]:line.trim(),run.node);
      }
      run.n++;
    }
    into.querySelectorAll('.jcomic').forEach(c=>c.classList.add('n'+Math.min(c.children.length,4)));
    return into;
  }

  function entryPage(en,side){
    if(en.locked)return lockedPage(en,side);
    const dt=parseDate(en.date)||parseDate(todayStr());
    const p=el('div','page '+side+' jp');
    const h=dateHead(dt,en.aside,en);
    const b=el('div','body');
    if(en.stamp){const st=el('div','stamp',[...en.stamp][0]);st.style.cssText='top:0;right:4px';b.appendChild(st);}
    const jt=el('div','jt');jt.appendChild(el('h2',null,en.title||'（无题）'));
    if(en.latin)jt.appendChild(el('div','latin',en.latin));
    b.appendChild(jt);
    // photos, like the sample pages' snapshots: one sits beside the words (they run round it), two or three
    // are taped down in a loose row under the title
    const k=en.lock&&keys()[en.lock];        // an opened locked page's photos need its key too
    const shots=photosOf(en).map((ph,i,all)=>{
      const f=el('figure','jph'),img=el('img');img.alt=ph.cap||'';img.decoding='async';img.loading='lazy';
      img.src=ph.url||('/img/'+ph.key+(k?'?k='+encodeURIComponent(k):''));
      f.append(el('div','tape'),img);
      if(ph.cap)f.appendChild(el('figcaption','cap',ph.cap));
      if(all.length>1)f.style.setProperty('--tilt',[-3,2.5,-1.5][i]+'deg');
      return f;
    });
    if(shots.length>1){const row=el('div','jphs n'+shots.length);shots.forEach(f=>row.appendChild(f));b.appendChild(row);}
    const tx=el('div','jtext');
    if(shots.length===1)tx.appendChild(shots[0]);
    bodyBlocks(en.body,tx);
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
    // text null: just paper (a page left over to keep left and right pages in step)
    if(text!==null){b.appendChild(mugSvg('mug-sleep',64));b.appendChild(el('div','hand',text||'下一页，还空着。'));}
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
    page.querySelectorAll('.body h2,.body .latin,.body .hand,.body .jtext>:not(.jcomic):not(.jph),.body .label,.body .bub,.body .stamp,.body .photo,.body .jph,.body .tape,.body .check,.body .wash,.body .comic .time,.body .jcomic .time,.body [data-draw]').forEach(n=>{
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


  /* ---------- a closer look: the page(s) open now, big, over the desk ----------
     On a phone a 530px page is shown at about two thirds of its size, too small for its small print (the
     footer, the corner calendar). This lays a copy of the open page(s) over the desk as wide as the screen,
     zoomable (＋/－, a double tap, or the browser's own pinch) and scrolled like any page. A copy of the live
     page, so it's exactly what the book shows, as it looks once written. ×, Esc and the back button close it. */
  const ZOOMS=[1,1.6,2.4];
  function reader(nodes){
    nodes=nodes.filter(Boolean);
    if(!nodes.length||document.querySelector('.reader'))return;
    const back=document.activeElement;
    const box=el('div','reader');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','放大看这一页');
    const sc=el('div','rd-scroll'),list=el('div','rd-pages');sc.tabIndex=0;sc.appendChild(list);
    const bar=el('div','rd-bar'),out=el('button','rd-btn','－'),inn=el('button','rd-btn','＋'),x=el('button','rd-btn rd-x','×');
    out.type=inn.type=x.type='button';
    out.setAttribute('aria-label','缩小');inn.setAttribute('aria-label','放大');x.setAttribute('aria-label','关闭');
    bar.append(out,inn,x);box.append(sc,bar);
    // on a touch screen "fit" is barely bigger than the book: say how to get closer (fades by itself)
    const tip=window.matchMedia&&matchMedia('(pointer: coarse)').matches?el('div','rd-tip','双击页面放大，双指也可以'):null;
    if(tip)box.appendChild(tip);
    const sheets=nodes.map(n=>{
      const c=n.cloneNode(true);
      // as it looks once written: take away what the draw-in hides until the pen gets there
      for(const e of c.querySelectorAll('[style]')){
        const st=e.style;
        if(st.opacity==='0')st.opacity='';
        if(st.fillOpacity==='0')st.fillOpacity='';
        if(st.strokeDashoffset){st.strokeDasharray='';st.strokeDashoffset='';}
      }
      // ids stay with the book's own page; a button in the copy presses the book's (复制 on 写信给我)
      c.querySelectorAll('[id]').forEach(e=>{e.dataset.rid=e.id;e.removeAttribute('id');});
      c.style.transform=c.style.position=c.style.left=c.style.top='';
      const sh=el('div','rd-sheet');sh.appendChild(c);list.appendChild(sh);
      return{sh,c};
    });
    list.addEventListener('click',e=>{
      const b=e.target.closest('button[data-rid]'),o=b&&document.getElementById(b.dataset.rid);
      if(!o)return;
      o.click();
      const echo=()=>{b.textContent=o.textContent;};
      setTimeout(echo,60);setTimeout(echo,1700);
    });
    let z=0;
    function size(){
      // "fit" is as wide as the screen allows (on a big screen no bigger than 1.4×)
      const k=Math.min((sc.clientWidth-24)/530,1.4)*ZOOMS[z];
      sheets.forEach(({sh,c})=>{sh.style.width=530*k+'px';sh.style.height=740*k+'px';c.style.transform='scale('+k+')';});
      out.disabled=z===0;inn.disabled=z===ZOOMS.length-1;
    }
    // zoom about a point on the screen (the middle by default): what's under it stays under it
    function zoom(to,cx,cy){
      to=Math.max(0,Math.min(ZOOMS.length-1,to));
      if(to===z)return;
      const r=sc.getBoundingClientRect();
      const px=(cx==null?r.width/2:cx-r.left),py=(cy==null?r.height/2:cy-r.top);
      const fx=(sc.scrollLeft+px)/sc.scrollWidth,fy=(sc.scrollTop+py)/sc.scrollHeight;
      z=to;size();if(tip)tip.remove();
      sc.scrollLeft=fx*sc.scrollWidth-px;sc.scrollTop=fy*sc.scrollHeight-py;
    }
    // a double tap zooms in on that spot (and back out); the page's own double-tap zoom is off (touch-action)
    let tap=0,tx=0,ty=0,tapped=0;
    sc.addEventListener('pointerup',e=>{
      if(e.pointerType==='mouse'||e.target.closest('a,button'))return;
      if(e.timeStamp-tap<320&&Math.hypot(e.clientX-tx,e.clientY-ty)<30){tap=0;tapped=e.timeStamp;zoom(z?0:1,e.clientX,e.clientY);}
      else{tap=e.timeStamp;tx=e.clientX;ty=e.clientY;}
    });
    sc.addEventListener('dblclick',e=>{
      if(e.timeStamp-tapped<600||e.target.closest('a,button'))return;
      zoom(z?0:1,e.clientX,e.clientY);
    });
    sc.addEventListener('mousedown',e=>{if(e.detail>1)e.preventDefault();});   // no word selected by the double click
    inn.onclick=()=>zoom(z+1);out.onclick=()=>zoom(z-1);
    // one step in the history, so the back button (or swipe) closes it rather than leaving the site
    history.pushState({techoReader:1},'');
    const done=()=>{if(history.state&&history.state.techoReader)history.back();else close();};
    x.onclick=done;
    const onKey=e=>{
      if(e.key==='Escape'){e.preventDefault();done();return;}
      if(e.target.closest&&e.target.closest('input,textarea,select,[contenteditable]'))return;
      // arrows scroll the copy, they don't turn the book behind it
      if(e.key==='ArrowLeft'||e.key==='ArrowRight')e.stopPropagation();
      if(e.key==='+'||e.key==='='){e.preventDefault();zoom(z+1);}
      if(e.key==='-'){e.preventDefault();zoom(z-1);}
    };
    function close(){
      if(!box.isConnected)return;
      box.remove();document.documentElement.classList.remove('reading');
      window.removeEventListener('keydown',onKey,true);window.removeEventListener('popstate',close);window.removeEventListener('resize',size);
      if(back&&back.focus)back.focus({preventScroll:true});
    }
    window.addEventListener('keydown',onKey,true);window.addEventListener('popstate',close);window.addEventListener('resize',size);
    document.documentElement.classList.add('reading');
    document.body.appendChild(box);
    size();
    sc.focus({preventScroll:true});
  }
  /* ---------- 跳到某一天: a little paper calendar in the nav, for both books ----------
     Like the one in a page's corner: the days with a page are marked and can be picked, the day open now is
     circled red; ‹ › go through the months that have pages. dates: the days there are pages for; now(): the
     day open now (or null); go(day): open the book there. */
  function dayPicker(dates,now,go){
    const have=new Set(dates.filter(Boolean));
    const months=[...new Set([...have].map(d=>d.slice(0,7)))].sort();
    if(!months.length)return null;
    const cal=el('button','arrow daypick');cal.type='button';
    cal.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    cal.setAttribute('aria-label','跳到某一天');cal.title='跳到某一天';
    cal.setAttribute('aria-haspopup','dialog');cal.setAttribute('aria-expanded','false');
    const pop=el('div','daypop');pop.hidden=true;pop.setAttribute('role','dialog');pop.setAttribute('aria-label','跳到某一天');
    const box=el('span','calbox');box.append(cal,pop);
    const pad=n=>String(n).padStart(2,'0');
    let shown=months[months.length-1];
    function paint(){
      const [y,mo]=shown.split('-').map(Number),mi=months.indexOf(shown),today=now();
      pop.textContent='';
      const head=el('div','dp-head');
      const pv=el('button','dp-nav','‹'),nx=el('button','dp-nav','›');
      pv.type=nx.type='button';pv.setAttribute('aria-label','上个月');nx.setAttribute('aria-label','下个月');
      pv.disabled=mi<=0;nx.disabled=mi>=months.length-1;
      pv.onclick=()=>{shown=months[mi-1];paint();};
      nx.onclick=()=>{shown=months[mi+1];paint();};
      const title=el('div','dp-title');
      title.append(el('b',null,String(mo)),el('span',null,'月'),el('i',null,y+' · '+MOE[mo-1]));
      head.append(pv,title,nx);
      const grid=el('div','dp-grid');
      '一二三四五六日'.split('').forEach(c=>grid.appendChild(el('span','dp-wd',c)));
      const off=(new Date(Date.UTC(y,mo-1,1)).getUTCDay()+6)%7,n=new Date(Date.UTC(y,mo,0)).getUTCDate();
      for(let i=0;i<off;i++)grid.appendChild(el('span'));
      for(let d=1;d<=n;d++){
        const day=y+'-'+pad(mo)+'-'+pad(d);
        if(!have.has(day)){grid.appendChild(el('span','dp-off',String(d)));continue;}
        const b=el('button','dp-day'+(day===today?' dp-now':''),String(d));b.type='button';
        b.setAttribute('aria-label',mo+'月'+d+'日');
        if(day===today)b.setAttribute('aria-current','date');
        b.onclick=()=>{close();go(day);};
        grid.appendChild(b);
      }
      pop.append(head,grid,el('div','dp-foot','点有小圆点的日子翻过去'));
    }
    const onDoc=e=>{if(!box.contains(e.target))close();};
    const onKey=e=>{if(e.key==='Escape'){close();cal.focus();}};
    function open(){
      const today=now();
      shown=today&&months.includes(today.slice(0,7))?today.slice(0,7):months[months.length-1];
      paint();pop.hidden=false;cal.setAttribute('aria-expanded','true');
      document.addEventListener('pointerdown',onDoc,true);document.addEventListener('keydown',onKey);
      const f=pop.querySelector('.dp-now')||pop.querySelector('.dp-day');if(f)f.focus({preventScroll:true});
    }
    function close(){
      pop.hidden=true;cal.setAttribute('aria-expanded','false');
      document.removeEventListener('pointerdown',onDoc,true);document.removeEventListener('keydown',onKey);
    }
    cal.onclick=()=>(pop.hidden?open():close());
    return box;
  }

  /* the nav's button for it; pages(): the page nodes open now */
  function readerButton(pages){
    const b=el('button','arrow zoomin');b.type='button';
    b.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4M6.8 4.6v4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    b.setAttribute('aria-label','放大看这一页');b.title='放大看这一页';b.setAttribute('aria-haspopup','dialog');
    b.onclick=()=>reader(pages());
    return b;
  }

  /* ---------- 时间线: the book's own table of contents, the pages after the flyleaf ----------
     Every diary page in the book (not the hand-made samples), newest first, a month at a time; a line
     per day that opens the book there (#YYYY-MM-DD, which both books follow). As many pages as it takes,
     always a spread's worth (a left page, then a right one), so the days after it keep their sides. The
     diary pages as cards, with their words and photos, are on the timeline page (/timeline/, timeline.js). */
  const TL_TOP=78,TL_BOTTOM=648,TL_MONTH=40,TL_ROW=34;
  function timelinePages(items){
    items=items.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.order-a.order));
    // lay the lines out on pages by height: a month heading, then its days; a month carried over says so
    const sheets=[];let cur=null,y=0,month=null;
    for(const it of items){
      const key=it.date.slice(0,7),head=key!==month||!cur;
      if(!cur||y+(head?TL_MONTH:0)+TL_ROW>TL_BOTTOM){cur=[];sheets.push(cur);y=TL_TOP;month=null;}
      if(key!==month){cur.push({month:key,more:sheets.length>1&&sheets[sheets.length-2].some(r=>r.date&&r.date.slice(0,7)===key)});y+=TL_MONTH;month=key;}
      cur.push(it);y+=TL_ROW;
    }
    const today=todayStr(),n=sheets.length;
    return sheets.map((rows,k)=>{
      const side=k%2===0?'l':'r',p=el('div','page '+side+' tlp');
      const h=el('header','head');
      const note=el('span','note');note.append('共 '+items.length+' 页',el('br'),'最新的在前');
      h.append(el('span','tl-t','时间线'),el('span','tl-l','timeline'),note);
      const list=el('div','tlp-list');
      rows.forEach(r=>{
        if(r.month){
          const [y,mo]=r.month.split('-').map(Number);
          const m=el('div','tlp-m');m.append(el('b',null,String(mo)),el('span',null,'月'),el('i',null,MOE[mo-1]+' '+y+(r.more?' · 续':'')));
          list.appendChild(m);return;
        }
        const d=parseDate(r.date),we=d.wd===0||d.wd===6;
        const a=el('a','tlp-row'+(we?' we':'')+(r.date===today?' today':'')+(r.locked?' locked':''));
        a.href='#'+r.date;
        a.append(el('span','tlp-d',String(d.mo).padStart(2,'0')+'.'+String(d.d).padStart(2,'0')),el('span','tlp-w',WD[d.wd]),el('span','tlp-t',r.title),el('span','tlp-go','›'));
        a.setAttribute('aria-label',d.mo+'月'+d.d+'日 '+r.title+'，翻到这一天');
        list.appendChild(a);
      });
      const f=el('footer','foot');
      // the same days as cards, with their words, doodles and photos: the timeline page (/timeline/)
      const all=el('a','tlp-all','整页看 →');all.href='/timeline/';
      const left=el('span');left.append('点一行，翻到那一天 · ',all);
      f.append(left,el('span','tlp-n',n>1?(k+1)+' / '+n:''));
      p.append(h,list,f);
      return p;
    });
  }

  /* The book's content, shared by the page-flip book (book.js) and the 3D book (book3d.js): data (inlined by the
     Worker as TECHO_DATA, or fetched), the owner's 手帐设置 applied to the built-in pages in `src`, fonts ready,
     and the page list in reading order. */
  async function loadBook(src){
    /* ---------- data: inlined by the Worker, or fetched ---------- */
    let entries=[],settings={},lock={book:false,open:[]};
    const held=keys(),inline=window.TECHO_DATA;
    if(inline){entries=inline.entries||[];settings=inline.settings||{};lock=inline.lock||lock;}
    // the tab holds keys to locked pages: ask for them opened (the inlined copy has them sealed)
    if(!inline||Object.keys(held).length){
      try{
        const [e,s]=await Promise.all([
          fetch('/api/entries',{headers:{accept:'application/json','x-techo-keys':Object.values(held).join(' ')}}).then(r=>r.ok?r.json():null),
          inline?null:fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():{settings:{}})
        ]);
        if(e){entries=e.entries||[];lock=e.lock||lock;
          // keys that no longer open anything (password changed, expired) are dropped
          const k={};(lock.open||[]).forEach(sc=>{if(held[sc])k[sc]=held[sc];});setKeys(k);}
        if(s)settings=s.settings||{};
      }catch(err){console.warn('techo: API unavailable, showing built-in pages only',err);}
    }
    const bookShut=lock.book&&!(lock.open||[]).includes('book');
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
    const pages=[];            // {node, hard, label, date: 'YYYY-MM-DD' for a diary page}
    const push=(node,opt)=>pages.push(Object.assign({node},opt||{}));
    const leftNext=()=>pages.length%2===1;
    push(q('.page.cover'),{hard:true});
    push(q('.page.inside.l'),{hard:true});
    push(q('.page.flyleaf'));
    const tlAt=pages.length;             // the timeline goes here, once the dated pages are known
    // the hand-made sample pages can be hidden. Their last page (写信给我, the contact details) is always the
    // book's last page: every newly published diary page goes in before it
    // a locked book keeps its sample pages shut away too
    const days=[...src.querySelectorAll('.day')],showSamples=settings.samples!=='hide'&&!bookShut;
    const contact=days.find(p=>p.querySelector('#mail'));
    // 写信给我 is the book's last page, written today: its date, month tab and little calendar are today's
    if(contact){
      const t=parseDate(todayStr()),h=contact.querySelector('.head');
      if(h){
        h.textContent='';
        const m=el('span','m');m.append(t.mo+'月',el('br'),MOE[t.mo-1]);
        const wd=el('span','wd'+(t.wd===0||t.wd===6?' we':''));wd.append(el('b',null,WD[t.wd]),el('i',null,WDE[t.wd]));
        const note=el('span','note');note.append('今天',el('br'),String(t.y));
        h.append(m,el('span','d',String(t.d)),wd,note);
      }
      const tab=contact.querySelector('.tab');if(tab)tab.textContent=String(t.mo);
      const oc=contact.querySelector('.cal');if(oc)oc.replaceWith(makeCal(t.y,t.mo,t.d));
    }
    // the samples are dated by their spread's label (9/25 …) in the year the journal began
    // (a spread holds two days: the label's on the left, the next on the right)
    const sampleDate=(l,plus)=>{const m=/^(\d+)\/(\d+)$/.exec(l||'');if(!m)return null;
      const t=new Date(Date.UTC(2026,+m[1]-1,+m[2]+plus));return t.toISOString().slice(0,10);};
    // sample: the hand-made pages. They keep dates (the calendar shows them) but aren't on the 时间线, and a
    // day that also has a diary page opens the diary page
    if(showSamples)days.forEach((p,i)=>p!==contact&&push(p,{label:i%2===0?p.dataset.label:null,date:p===contact?null:sampleDate(days[i-i%2].dataset.label,i%2),sample:true}));
    sortEntries(entries).forEach(en=>{
      const side=leftNext()?'l':'r',d=parseDate(en.date);
      push(fitText(entryPage(en,side)),{label:side==='l'&&d?(d.mo+'/'+d.d):null,date:d?en.date:null});
    });
    // the timeline, after the flyleaf: its pages come in pairs, so every page after it keeps its side
    const dated=pages.slice(tlAt).map((p,i)=>p.date&&!p.sample&&{date:p.date,order:i,locked:p.node.classList.contains('locked'),
      title:p.node.classList.contains('locked')?'上了锁的一页':((p.node.querySelector('h2')||{}).textContent||'（无题）').replace(/\s+/g,'')}).filter(Boolean);
    if(dated.length){
      const tl=timelinePages(dated).map((node,k)=>({node,label:k===0?'时间线':null}));
      if(tl.length%2)tl.push({node:blankPage('r',null)});
      pages.splice(tlAt,0,...tl);
    }
    if(contact){
      if(leftNext())push(blankPage('l',null));                // contact is a right-hand page
      push(contact);
    }
    // the last page before the inside back cover is always the next one, still empty (a left-hand page)
    if(!leftNext())push(blankPage('r',null));
    push(blankPage('l','下一页，还空着。'));
    push(q('.page.inside.r'),{hard:true});
    push(q('.page.backcover'),{hard:true});
    // a locked book says so on its cover; a tab holding keys can lock it again (a link under the nav)
    if(bookShut){
      const cue=el('button','lockbtn lockcue');cue.type='button';cue.dataset.scope='book';
      cue.innerHTML='<svg width="13" height="14" viewBox="0 0 13 14" aria-hidden="true"><rect x="1.5" y="6" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M3.8 6V4.2a2.7 2.7 0 0 1 5.4 0V6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
      cue.append('上了锁 · 输入口令');
      const cover=q('.page.cover');if(cover)cover.appendChild(cue);
    }
    if((lock.open||[]).length){
      const hint=document.querySelector('.hint');
      if(hint&&!document.getElementById('relock')){const r=el('button','relock','重新上锁');r.type='button';r.id='relock';r.onclick=relock;hint.appendChild(r);}
    }
    return {pages,settings,lock};
  }
  const stickerList=Object.keys(STICKERS).map(k=>({key:k,label:STICKERS[k][0]}));
  /* the "drag the corner" note beside the cover: fades and drifts away when the book opens (or a corner is
     taken), and once the reader has opened the book it has done its job: it doesn't come back on the cover */
  let noteDone=false;
  function dragNote(el,show){
    if(!el)return;
    if(!show&&!el.hidden&&el.dataset.shown==='1')noteDone=true;
    show=show&&!noteDone;
    clearTimeout(el.__t);
    if(show){el.hidden=false;el.dataset.shown='1';requestAnimationFrame(()=>el.classList.remove('gone'));}
    else if(!el.hidden){el.classList.add('gone');el.__t=setTimeout(()=>{el.hidden=true;},600);}
  }
  window.Techo={askUnlock,relock,keys,dragNote,loadBook,stickerList,stickerSvg,el,parseDate,todayStr,sortEntries,makeCal,mugSvg,entryPage,blankPage,fitText,measure,prepDraw,playDraw,reader,readerButton,dayPicker,bodyBlocks,plainText};
})();
