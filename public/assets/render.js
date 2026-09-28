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
    return String(md||'').replace(/```[\s\S]*?```/g,' ').replace(/^\s*\+{3,}\s*$/gm,' ').replace(NETEASE_LINE,' ').replace(/^\s*(#{1,3}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|[@＠]\d{1,2}[:：]\d{2}\s*)/gm,'')
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
    ['brk',/^\s*\+{3,}\s*$/],
    ['hr',/^\s*([-*_])(\s*\1){2,}\s*$/],
    ['check',/^\s*(?:[-*+]\s+)?\[( |x|X|✓|√)\]\s+(.*)$/],
    ['ul',/^\s*[-*+•]\s+(.*)$/],
    ['ol',/^\s*(\d{1,3})[.)、]\s+(.*)$/],
    ['quote',/^\s*[>＞]\s?(.*)$/],
    ['panel',/^\s*[@＠](\d{1,2}[:：]\d{2})\s*(.*)$/],
  ];
  /* ---------- 账单 / 机票 / 车票: the paper a day leaves behind, stuck on the page ----------
     Written as a fenced block, a line per item, "名称: 内容" (a colon and a space, or a full-width colon).
     账单 (```receipt), a till receipt: "# 标题", "> 居中的小字", "---" a dashed rule, "= 总计: ¥128" the big
     total, "* 分组: ¥" a bold line, "- 明细: ¥" an indented one, "名称: 内容" a line; anything else, centred.
     机票 (```flight) and 车票 (```train) take the items they know (航班、从、到、日期、座位 … see TICKET_KEYS),
     whatever else is written is left off. All made of text nodes: nothing written is taken as HTML. */
  const TICKET_NAMES={receipt:'receipt',bill:'receipt','账单':'receipt','小票':'receipt',flight:'flight','机票':'flight','登机牌':'flight',train:'train','车票':'train','火车票':'train',
    book:'book','书':'book','书籍':'book','读书':'book',
    // 影视: the film (its poster, its rating); 电影票: the ticket to it
    movie:'film',film:'film',tv:'film','电影':'film','影视':'film','剧':'film','追剧':'film','剧集':'film',
    cinema:'cinema',ticket:'cinema','电影票':'cinema','影票':'cinema','观影':'cinema',
    music:'music',song:'music','音乐':'music','歌':'music','听歌':'music'};
  const TICKET_KEYS={
    airline:['航空','航空公司','airline'],flight:['航班','航班号','flight'],from:['从','出发','起点','from'],to:['到','目的地','终点','to'],
    date:['日期','date'],dep:['起飞','发车','出发时间','开车','dep','time'],arr:['到达','到达时间','arr'],gate:['登机口','检票','检票口','gate'],
    seat:['座位','座','seat'],cls:['舱位','席别','等级','class'],name:['乘客','旅客','姓名','name'],boarding:['登机','登机时间','boarding'],
    train:['车次','train'],car:['车厢','car'],price:['票价','价格','price'],no:['票号','no'],
    // 书籍 / 影视 / 音乐
    title:['书名','片名','剧名','歌名','标题','title'],author:['作者','author'],publisher:['出版社','出版','publisher'],
    progress:['进度','读到','progress'],rating:['评分','打分','rating'],quote:['书摘','摘录','短评','一句话','歌词','quote','lyric'],
    director:['导演','director'],cast:['主演','演员','cast'],where:['影院','平台','在哪看','cinema','where'],hall:['影厅','厅','hall'],
    episode:['集数','季','episode'],type:['类型','type'],artist:['歌手','艺人','乐队','artist'],album:['专辑','album'],
    length:['时长','length'],at:['听到','at'],show:['场次','放映'],
    cover:['封面','海报','poster','cover'],year:['年份','上映','year'],brief:['简介','brief'],state:['状态','state'],isbn:['isbn'],
    netease:['网易云','网易云音乐','netease'],link:['链接','link','url'],
  };
  const KEY_OF={};Object.entries(TICKET_KEYS).forEach(([k,names])=>names.forEach(n=>{KEY_OF[n.toLowerCase()]=k;}));
  const kvOf=line=>{const m=/^\s*(.+?)\s*(?:：|:\s)\s*(.*?)\s*$/.exec(line);return m?[m[1],m[2]]:null;};
  function ticketFields(lines){
    const f={};
    lines.forEach(l=>{const kv=kvOf(l);if(!kv)return;const k=KEY_OF[kv[0].toLowerCase()];if(k&&!f[k])f[k]=kv[1];});
    return f;
  }
  // "PEK 北京首都" → code PEK, name 北京首都; "北京南 Beijingnan" → 北京南, Beijingnan
  const place=v=>{const s=String(v||'').trim(),m=/^([A-Z]{3})\s+(.+)$/.exec(s);if(m)return{code:m[1],name:m[2]};const n=/^(\S+)\s+(.+)$/.exec(s);return n?{code:n[1],name:n[2]}:{code:s,name:''};};
  // 封面 / 海报: a picture of the journal's own (p/<uuid>.jpg, from 🔍 NeoDB or an upload) or a web address
  const imgSrc=v=>{const s=String(v||'').trim();return /^p\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(s)?'/img/'+s:/^https:\/\/\S+$/.test(s)?s:'';};
  const picture=(src,alt)=>{const i=el('img');i.src=src;i.alt=alt||'';i.loading='lazy';i.decoding='async';i.referrerPolicy='no-referrer';return i;};
  // a series rather than a film (剧情 is a genre, not a series)
  const SERIES=/剧集|电视剧|连续剧|网剧|美剧|日剧|韩剧|英剧|综艺|番剧|\btv\b|series/i;
  // a colour of its own for a title (the book's cover, the record's sleeve): the same title, the same colour
  const hueOf=s=>{let h=5;for(const ch of String(s||''))h=(h*33+ch.charCodeAt(0))>>>0;return h%360;};
  // 评分: "4.5", "9/10", "★★★★" → five stars filled that far
  function stars(v){
    const s=String(v||'').trim();if(!s)return null;
    let r=(s.match(/★/g)||[]).length;
    if(!r){const m=/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/.exec(s);if(!m)return null;r=+m[1]*(m[2]?5/+m[2]:(+m[1]>5?.5:1));}
    r=Math.max(0,Math.min(5,r));
    const w=el('span','jstars');w.setAttribute('role','img');w.setAttribute('aria-label','评分 '+(Math.round(r*10)/10)+' / 5');
    const on=el('span','on','★★★★★');on.style.width=(r/5*100)+'%';w.append(el('span','off','★★★★★'),on);
    return w;
  }
  // a bar filled to a fraction (0–1)
  const bar=(k,cls)=>{const b=el('div','jbar'+(cls?' '+cls:''));const f=el('i');f.style.width=Math.round(Math.max(0,Math.min(1,k))*100)+'%';b.appendChild(f);return b;};
  const secs=t=>{const m=/^(\d+):(\d{1,2})$/.exec(String(t||'').trim());return m?+m[1]*60+ +m[2]:null;};
  /* What holds a card on the page: a receipt's paper clip, otherwise a strip or two of washi tape across a
     corner. Its colour, and which corners, from what's written: the same card is always held the same way. */
  const TAPES=['rgba(236,214,150,.82)','rgba(169,208,196,.8)','rgba(240,178,170,.78)','rgba(196,190,228,.78)'];
  function fasten(card,text){
    let h=11;for(const ch of text)h=(h*37+ch.charCodeAt(0))>>>0;
    if(card.classList.contains('jreceipt')){card.appendChild(el('i','jclip'));return;}
    const t=el('i','jtape '+(h%2?'tl':'tr'));t.style.setProperty('--tape',TAPES[h%TAPES.length]);card.appendChild(t);
    if(h%3===0){const b=el('i','jtape '+(h%2?'br':'bl'));b.style.setProperty('--tape',TAPES[(h>>3)%TAPES.length]);card.appendChild(b);}
  }
  /* ---------- 网易云 through Meting (手帐设置 → 接入服务 → 网易云音乐): a song's name, singer, cover, words and sound ----------
     "网易云: 186016" or a music.163.com link. The Meting API is any of the public ones (or one's own); its
     answers differ a little (title / name, author / artist), both are taken. */
  const METING_DEFAULT='https://api.injahow.cn/meting/';
  const neteaseId=v=>{const s=String(v||'').trim();if(!s)return '';if(/^\d{3,12}$/.test(s))return s;const m=/music\.163\.com\/.*?(?:song\?id=|song\/)(\d+)/.exec(s)||/[?&]id=(\d+)/.exec(/163\.com/.test(s)?s:'');return m?m[1]:'';};
  const metingCache=new Map();
  // api: another Meting API than the journal's (its 试一下 in 手帐设置)
  function meting(id,api){
    const base=(api||site.metingApi||METING_DEFAULT).trim(),ck=base+'|'+id;
    if(!metingCache.has(ck)){
      const u=/:id/.test(base)?base.replace(':server','netease').replace(':type','song').replace(':id',encodeURIComponent(id)).replace(':r',String(Math.random()).slice(2))
        :base+(base.includes('?')?'&':'?')+'server=netease&type=song&id='+encodeURIComponent(id);
      metingCache.set(ck,fetch(u).then(r=>{if(!r.ok)throw new Error('meting '+r.status);return r.json();}).then(j=>{
        const x=Array.isArray(j)?j[0]:j&&(j.data&&j.data[0]||j);
        if(!x||!x.url)throw new Error('meting: no song '+id);
        return{title:x.title||x.name||'',artist:x.author||x.artist||'',url:x.url,pic:x.pic||x.cover||'',lrc:x.lrc||''};
      }));
      metingCache.get(ck).catch(()=>metingCache.delete(ck));
    }
    return metingCache.get(ck);
  }
  // "[01:23.45]words" lines → [[seconds, words], …]
  function lrcLines(text){
    const out=[];
    String(text||'').split(/\r?\n/).forEach(l=>{
      const ts=[...l.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)],w=l.replace(/\[[^\]]*\]/g,'').trim();
      if(w)ts.forEach(t=>out.push([+t[1]*60+ +t[2],w]));
    });
    return out.sort((a,b)=>a[0]-b[0]);
  }
  const PLAY_ICON='<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 1.8v10.4L12 7z" fill="currentColor"/></svg>';
  const PAUSE_ICON='<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor"/></svg>';
  let playing=null;   // the one card playing: another's play stops it
  const clock=t=>{t=Math.max(0,Math.floor(t||0));return Math.floor(t/60)+':'+String(t%60).padStart(2,'0');};
  function wirePlayer(card,f){
    let audio=null,lines=null;
    const q=s=>card.querySelector(s);
    const stop=e=>e.stopPropagation();
    const paint=()=>{
      const on=!!audio&&!audio.paused,btn=q('.jmu-play');
      card.classList.toggle('playing',on);btn.innerHTML=on?PAUSE_ICON:PLAY_ICON;btn.setAttribute('aria-label',on?'暂停':'播放');
    };
    const tick=()=>{
      if(!audio)return;
      const d=audio.duration||0,t=audio.currentTime||0;
      q('.jmu-progress i').style.width=(d?t/d*100:0)+'%';q('.jmu-at').textContent=clock(t);if(d)q('.jmu-len').textContent=clock(d);
      if(lines&&lines.length){let w='';for(const [s,x] of lines){if(s<=t+.2)w=x;else break;}if(w)q('.jmu-lyric').textContent='♫ '+w;}
    };
    // the page-flip book listens to the mouse and to touch to turn the page: these belong to the player
    ['pointerdown','mousedown','mouseup','touchstart','touchend'].forEach(k=>{q('.jmu-play').addEventListener(k,stop);q('.jmu-progress .jbar').addEventListener(k,stop);});
    q('.jmu-play').addEventListener('click',async e=>{
      e.stopPropagation();
      if(audio&&!audio.paused){audio.pause();return;}
      if(!audio){
        const song=card.__song||await meting(neteaseId(f.netease||f.link)).catch(()=>null);
        if(!song||!song.url){card.classList.add('failed');q('.jmu-lyric').textContent='这首歌放不了（换个 Meting 接口试试）';return;}
        audio=new Audio(song.url);audio.preload='auto';
        audio.addEventListener('timeupdate',tick);audio.addEventListener('loadedmetadata',tick);
        ['play','pause','ended'].forEach(k=>audio.addEventListener(k,paint));
        audio.addEventListener('error',()=>{q('.jmu-lyric').textContent='这首歌放不了（可能要会员，或接口失效）';paint();});
        if(song.lrc)(/^https?:/.test(song.lrc)?fetch(song.lrc).then(r=>r.text()):Promise.resolve(song.lrc)).then(t=>{lines=lrcLines(t);}).catch(()=>{});
      }
      if(playing&&playing!==audio)playing.pause();
      playing=audio;
      audio.play().catch(()=>{q('.jmu-lyric').textContent='浏览器没让它出声，再点一下试试';});
    });
    q('.jmu-progress .jbar').addEventListener('click',e=>{
      e.stopPropagation();
      if(!audio||!audio.duration)return;
      const r=e.currentTarget.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*audio.duration;tick();
    });
  }
  const PLANE='<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15.5v-1.8l-8-5V3.5a1.5 1.5 0 0 0-3 0v5.2l-8 5v1.8l8-2.5v5.3l-2 1.5V21l3.5-1 3.5 1v-1.2l-2-1.5V13z" fill="currentColor"/></svg>';
  const TICKETS={
    book(lines){
      const f=ticketFields(lines),title=f.title||'书名',h=hueOf(title);
      const card=el('div','jticket jbook');
      const cover=el('div','jb-cover');cover.style.setProperty('--h',h);
      const src=imgSrc(f.cover);
      // its own cover, if there is one; else a cloth one with a Chinese title running down it a character to a
      // line (any other goes across)
      if(src){cover.classList.add('pic');cover.appendChild(picture(src,title));}
      else cover.append(el('b',/[\u3400-\u9fff]/.test(title)?'v':null,title),el('small',null,f.author||''));
      const info=el('div','jb-info');
      // 进度: "132/360" pages, "65%", or 读完
      let k=null,said='';
      const p=String(f.progress||'').trim(),pm=/^(\d+)\s*\/\s*(\d+)/.exec(p),pc=/^(\d+(?:\.\d+)?)\s*%$/.exec(p);
      if(pm){k=+pm[1]/Math.max(1,+pm[2]);said=pm[1]+' / '+pm[2]+' 页';}else if(pc){k=+pc[1]/100;said=pc[1]+'%';}else if(/读完|完/.test(p)){k=1;said='读完了';}else if(p)said=p;
      info.append(el('div','jb-state',f.state||(k===1?'读完 FINISHED':'在读 READING')),el('div','jb-title',title));
      const by=[f.author,f.publisher].filter(Boolean).join(' · ');if(by)info.appendChild(el('div','jb-by',by));
      const st=stars(f.rating);if(st)info.appendChild(st);
      if(k!=null||said){const pr=el('div','jb-progress');if(k!=null)pr.appendChild(bar(k));pr.appendChild(el('span',null,said));info.appendChild(pr);}
      if(f.quote)info.appendChild(el('blockquote','jb-quote',f.quote));
      card.append(cover,info);
      return card;
    },
    // 影视: the film or series itself — its poster in a white border, what it is, its rating, a line about it
    film(lines){
      const f=ticketFields(lines),title=f.title||'片名',tv=SERIES.test(f.type||'')||!!f.episode;
      const card=el('div','jticket jfilm'),poster=el('div','jfi-poster');poster.style.setProperty('--h',hueOf(title));
      const src=imgSrc(f.cover);
      if(src)poster.appendChild(picture(src,title));else poster.appendChild(el('b',null,title));
      const info=el('div','jfi-info');
      info.appendChild(el('div','jfi-state',f.state||(tv?'在追 WATCHING':'看过 WATCHED')));
      const t=el('div','jfi-title',title);if(f.year)t.appendChild(el('small',null,f.year));info.appendChild(t);
      const who=[f.director&&'导演 '+f.director,f.cast&&'主演 '+f.cast].filter(Boolean).join(' / ');if(who)info.appendChild(el('div','jfi-who',who));
      const tags=[...String(f.type||'').split(/[\/、,，\s]+/).filter(Boolean).slice(0,3),f.episode&&f.episode].filter(Boolean);
      if(tags.length){const r=el('div','jfi-tags');tags.forEach(x=>r.appendChild(el('span',null,x)));info.appendChild(r);}
      const st=stars(f.rating);
      if(st){const r=el('div','jfi-rating');const n=/^\d+(?:\.\d+)?/.exec(String(f.rating).trim());if(n)r.appendChild(el('b',null,n[0]));r.appendChild(st);info.appendChild(r);}
      if(f.brief)info.appendChild(el('div','jfi-brief',f.brief));
      if(f.quote)info.appendChild(el('div','jfi-quote','“'+f.quote+'”'));
      card.append(poster,info);
      return card;
    },
    // 电影票: a cinema ticket, its red stub torn along the perforation
    cinema(lines){
      const f=ticketFields(lines),tv=SERIES.test(f.type||'')||!!f.episode;
      const card=el('div','jticket jmovie'),stub=el('div','jm-stub'),main=el('div','jm-main');
      stub.append(el('b',null,tv?'追剧':'入场券'),el('small',null,tv?'NOW WATCHING':'ADMIT ONE'));
      const top=el('div','jm-top');top.append(el('span',null,tv?'剧集 · TV':'电影票 · CINEMA'),el('span',null,[f.date,f.show||f.dep].filter(Boolean).join('  ')));
      const t=el('div','jm-title',f.title||'片名');if(f.type)t.appendChild(el('span','jm-type',f.type));
      const rows=el('div','jm-fields');
      [['影院 / 平台',f.where],['影厅',f.hall],['座位',f.seat],['集数',f.episode]].filter(x=>x[1]).slice(0,3)
        .forEach(([k,v])=>{const d=el('div');d.append(el('small',null,k),el('b',null,v));rows.appendChild(d);});
      main.append(top,t);
      if(rows.children.length)main.appendChild(rows);
      const who=[f.director&&'导演 '+f.director,f.cast&&'主演 '+f.cast].filter(Boolean).join('　');if(who)main.appendChild(el('div','jm-who',who));
      const foot=el('div','jm-foot');const st=stars(f.rating);if(st)foot.appendChild(st);if(f.quote)foot.appendChild(el('span','jm-quote','“'+f.quote+'”'));
      if(foot.children.length)main.appendChild(foot);
      card.append(stub,main);
      return card;
    },
    music(lines){
      const f=ticketFields(lines),ne=neteaseId(f.netease||f.link),title=f.title||(ne?'…':'歌名'),h=hueOf((f.album||'')+(f.title||ne||''));
      const card=el('div','jticket jmusic'+(ne?' netease':''));
      const art=el('div','jmu-art');art.style.setProperty('--h',h);
      const disc=el('div','jmu-disc'),sleeve=el('div','jmu-sleeve');
      const src=imgSrc(f.cover);
      if(src)sleeve.appendChild(picture(src,f.album||title));else sleeve.appendChild(el('span',null,f.album||f.title||''));
      art.append(disc,sleeve);
      const info=el('div','jmu-info');
      const tt=el('div','jmu-title',title),by=el('div','jmu-by',[f.artist,f.album&&'《'+f.album+'》'].filter(Boolean).join(' · '));
      info.append(el('div','jmu-now',ne?'♪ 网易云音乐 · NOW PLAYING':'♪ 正在听 NOW PLAYING'),tt,by);
      const a=secs(f.at),L=secs(f.length);
      let pr=null;
      if(L||ne){
        pr=el('div','jmu-progress');
        const sk=el(ne?'button':'div','jbar knob');const fill=el('i');fill.style.width=(L&&a!=null?Math.round(Math.min(1,a/L)*100):0)+'%';sk.appendChild(fill);
        if(ne){sk.type='button';sk.setAttribute('aria-label','播放进度');}
        pr.append(el('span','jmu-at',f.at||'0:00'),sk,el('span','jmu-len',f.length||'--:--'));info.appendChild(pr);
      }
      const st=stars(f.rating);if(st)info.appendChild(st);
      const ly=el('div','jmu-lyric',f.quote?'♫ '+f.quote:'');if(f.quote||ne)info.appendChild(ly);
      card.append(art,info);
      if(ne){
        // 网易云: the song itself, through Meting — what's not written comes from there, and it plays right here
        const play=el('button','jmu-play');play.type='button';play.innerHTML=PLAY_ICON;play.setAttribute('aria-label','播放');
        art.appendChild(play);
        meting(ne).then(song=>{
          if(!f.title)tt.textContent=song.title||'（没有歌名）';
          if(!f.artist&&!f.album&&song.artist)by.textContent=song.artist;
          if(!src&&song.pic){sleeve.textContent='';sleeve.appendChild(picture(song.pic,song.title));}
          card.dataset.src=song.url||'';card.__song=song;
        }).catch(e=>{console.warn('techo: meting',e);if(!f.title)tt.textContent='这首歌没加载上';card.classList.add('failed');});
        wirePlayer(card,f);
      }
      return card;
    },
    receipt(lines){
      const r=el('div','jticket jreceipt');
      lines.forEach(raw=>{
        let l=raw.trim();if(!l)return;
        let m;
        if(/^[-=*_]{3,}$/.test(l)){r.appendChild(el('div','jr-hr'));return;}
        if((m=/^#\s+(.+)$/.exec(l))){r.appendChild(el('div','jr-title',m[1]));return;}
        if((m=/^[>＞]\s?(.*)$/.exec(l))){r.appendChild(el('div','jr-note',m[1]));return;}
        if((m=/^=\s*(.+)$/.exec(l))){
          const kv=kvOf(m[1]),t=el('div','jr-total');
          if(kv)t.append(el('small',null,kv[0]),el('strong',null,kv[1]));else t.appendChild(el('strong',null,m[1]));
          r.appendChild(t);return;
        }
        let cls='jr-row';
        if((m=/^\*\s+(.+)$/.exec(l))){cls+=' jr-group';l=m[1];}
        else if((m=/^-\s+(.+)$/.exec(l))){cls+=' jr-sub';l=m[1];}
        const kv=kvOf(l);
        if(!kv){r.appendChild(el('div','jr-text',l));return;}
        const row=el('div',cls);row.append(el('span',null,kv[0]),el('span',null,kv[1]));r.appendChild(row);
      });
      return r;
    },
    flight(lines){
      const f=ticketFields(lines),a=place(f.from),b=place(f.to);
      const card=el('div','jticket jflight'),main=el('div','jf-main'),stub=el('div','jf-stub');
      const band=el('div','jf-band');band.append(el('span',null,f.airline||'航空公司'),el('span',null,'登机牌 BOARDING PASS'));
      const route=el('div','jf-route');
      const port=(p,k)=>{const d=el('div','jf-port '+k);d.append(el('b',null,p.code||'—'),el('span',null,p.name));return d;};
      const mid=el('div','jf-plane');mid.innerHTML=PLANE;   // (the drawing only; nothing written goes in here)
      route.append(port(a,'from'),mid,port(b,'to'));
      const fields=el('div','jf-fields');
      [['日期 DATE',f.date],['起飞 DEP',f.dep],['到达 ARR',f.arr],['登机口 GATE',f.gate],['登机 BOARDING',f.boarding],['舱位 CLASS',f.cls]].filter(x=>x[1]).slice(0,4)
        .forEach(([k,v])=>{const d=el('div');d.append(el('small',null,k),el('b',null,v));fields.appendChild(d);});
      main.append(band,route,fields);
      if(f.name){const n=el('div','jf-name');n.append(el('small',null,'旅客 PASSENGER'),el('b',null,f.name));main.appendChild(n);}
      stub.append(el('small',null,'航班 FLIGHT'),el('b','jf-no',f.flight||'—'),el('small',null,'座位 SEAT'),el('b','jf-seat',f.seat||'—'),el('div','jf-bar'));
      card.append(main,stub);
      return card;
    },
    train(lines){
      const f=ticketFields(lines),a=place(f.from),b=place(f.to);
      const card=el('div','jticket jtrain');
      // the red number in the corner: the same for the same ticket
      let h=7;for(const ch of lines.join('|'))h=(h*31+ch.charCodeAt(0))>>>0;
      const no=f.no||('Z'+String(h%100000000).padStart(8,'0'));
      const top=el('div','jt-top');top.append(el('span','jt-no',no),el('span',null,f.gate?'检票：'+f.gate:''));
      const st=(p)=>{const d=el('div','jt-st');const n=el('b',null,p.code||'—');n.appendChild(el('i',null,'站'));d.append(n,el('span',null,p.name));return d;};
      const mid=el('div','jt-mid');mid.append(el('b',null,f.train||'—'),el('span','jt-arrow','⟶'));
      const route=el('div','jt-route');route.append(st(a),mid,st(b));
      const when=el('div','jt-row');when.append(el('span',null,[f.date,f.dep&&f.dep+'开'].filter(Boolean).join(' ')),el('span',null,[f.car&&f.car+'车',f.seat&&f.seat+'号'].filter(Boolean).join('')));
      const pay=el('div','jt-row');pay.append(el('span',null,f.price?(/[¥￥]/.test(f.price)?f.price:'¥'+f.price)+(/元$/.test(f.price)?'':'元'):''),el('span',null,f.cls||''));
      const who=el('div','jt-row jt-who');who.append(el('span',null,f.name||''),el('span','jt-qr'));
      card.append(top,route,when,pay,who,el('div','jt-foot','买票请到12306　发货请到95306'));
      return card;
    },
  };
  /* a line that is only a NetEase song link (music.163.com/song?id=…, the app's y.music.163.com/m/song?id=…,
     #/song?id=…): its player, as if written as ```音乐 with 网易云: <link> */
  const NETEASE_LINE=/^[ \t]*https?:\/\/(?:y\.)?music\.163\.com\/\S*song\S*[ \t]*$/gm;
  const neteaseLine=l=>/^\s*https?:\/\/(?:y\.)?music\.163\.com\/\S*song\S*\s*$/.test(l)&&neteaseId(l.trim());
  function bodyBlocks(body,into){
    const lines=String(body||'').replace(/\r\n?/g,'\n').split('\n');
    let run=null;                              // the block lines are going into: {kind, node}
    const open=(kind,node)=>{run={kind,node,n:0};into.appendChild(node);return node;};
    // a card taped on; one right after another: a pile, each on the one before (a stack of tickets that won't
    // all lie flat) (the tickets: 账单 / 机票 / 车票 / 电影票; a book, a film or a record lies on its own)
    const stick=(c,text)=>{
      fasten(c,text);
      const prev=into.lastElementChild,pile=n=>n&&n.matches('.jreceipt,.jflight,.jtrain,.jmovie');
      if(pile(c)&&pile(prev)){const st=el('div','jstack');prev.replaceWith(st);st.append(prev,c);}
      else if(pile(c)&&prev&&prev.classList.contains('jstack'))prev.appendChild(c);
      else open('ticket',c);
      [...(c.parentNode.classList.contains('jstack')?c.parentNode.children:[])].forEach((t,i)=>t.style.setProperty('--i',i));
    };
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(!line.trim()){run=null;continue;}     // an empty line ends whatever block this was
      let kind='p',m=null;
      for(const [k,re] of BLOCKS){m=re.exec(line);if(m){kind=k;break;}}
      if(kind==='p'&&neteaseLine(line)){stick(TICKETS.music(['网易云: '+line.trim()]),line);run=null;continue;}
      if(kind==='fence'){
        const code=[],info=((/^\s*```\s*(\S*)/.exec(line)||[])[1]||'').toLowerCase();
        while(++i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i]);
        // ```receipt / ```flight / ```train (or 账单 / 机票 / 车票): a bill, a boarding pass, a train ticket
        const card=TICKETS[TICKET_NAMES[info]];
        if(card){stick(card(code),code.join('|'));run=null;continue;}
        const pre=open('code',el('pre','jcode'));pre.appendChild(el('code',null,code.join('\n')));run=null;continue;
      }
      if(kind==='h'){open('h',inline(m[2].trim(),el('div','jh jh'+m[1].length)));run=null;continue;}
      if(kind==='hr'){open('hr',el('div','jhr'));run=null;continue;}
      if(kind==='brk'){open('brk',el('div','jbrk'));run=null;continue;}   // +++: the words go on over the page (entryPages)
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

  /* A diary page. entryShell: the paper, its date and (the first page) the title, the stamp and the photos,
     with an empty .jtext for the words; a page carrying on from the one before says so at its top instead.
     entryEnd: how the page ends, the note's stickers, the mug and the quote at its foot (the last page), or
     接下页 (any other). entryPage is the whole of it on one page; entryPages as many pages as it takes. */
  function entryShell(en,side,first){
    const dt=parseDate(en.date)||parseDate(todayStr());
    const p=el('div','page '+side+' jp'+(first?'':' cont'));
    if(en.id)p.dataset.id=en.id;          // for 放大看's 分享 (/p/<id>)
    const h=dateHead(dt,first?en.aside:null,en);
    const b=el('div','body');
    const tx=el('div','jtext');
    if(!first){b.append(el('div','jcont hand',(en.title||'（无题）')+' · 续'),tx);return finish();}
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
    if(shots.length===1)tx.appendChild(shots[0]);
    const map=pageMap(en);if(map)tx.appendChild(map);
    b.appendChild(tx);
    return finish();
    function finish(){
      p.append(h,b);
      const f=el('footer','foot');
      if(side==='r')f.style.right='130px';
      p.appendChild(f);
      if(side==='r'){p.appendChild(el('div','tab',String(dt.mo)));p.appendChild(makeCal(dt.y,dt.mo,dt.d));}
      return {p,b,tx,f};
    }
  }
  function entryEnd(s,en,last){
    s.b.querySelectorAll(':scope>.jstk,:scope>.jmug').forEach(n=>n.remove());
    s.f.textContent='';s.f.classList.toggle('more',!last);
    if(!last){s.f.append('接下页 →');return;}
    const stk=(Array.isArray(en.stickers)?en.stickers:String(en.stickers||'').split(',')).filter(k=>STICKERS[k]).slice(0,2);
    if(stk.length){
      const row=el('div','jstk'+(en.mood&&en.mood!=='none'?' by-mug':''));
      stk.forEach(k=>row.appendChild(stickerSvg(k,62)));
      s.b.appendChild(row);
    }
    if(en.mood&&en.mood!=='none'){const g=mugSvg(en.mood==='sleep'?'mug-sleep':'mug',64);g.setAttribute('class','jmug');s.b.appendChild(g);}
    if(en.quote){s.f.append(en.quote);if(en.quoteSrc)s.f.appendChild(el('small',null,'—— '+en.quoteSrc));}
  }
  // the words of a page, block by block (the note, taped on, last)
  function entryWords(en,into){
    bodyBlocks(en.body,into);
    if(en.note){const n=el('div','label jnote',en.note);n.appendChild(el('div','tape'));into.appendChild(n);}
    return into;
  }
  function entryPage(en,side){
    if(en.locked)return lockedPage(en,side);
    const s=entryShell(en,side,true);
    entryWords(en,s.tx);entryEnd(s,en,true);
    return s.p;
  }

  /* A diary page as many pages as it takes. On one page when the words fit at FIT_MIN or bigger (as big as
     they fit), otherwise they run on at RUN_FS a block at a time (a paragraph, a list, a quote, a comic strip,
     a code block …): a paragraph that doesn't fit what's left of a page is split after a sentence, a list or
     a comic strip after an item, and a heading never ends a page. A +++ line starts a new page. A block too
     big even for a page of its own is cut off at its foot, as a page always was. */
  const FIT_MAX=19,FIT_MIN=16,RUN_FS=17;
  const over=t=>t.scrollHeight>t.clientHeight+1;
  const SENTENCE=/[^。！？!?；;…]*[。！？!?；;…]+[”’」』）)\]]*\s*|[^。！？!?；;…]+/g;
  function entryPages(en,side){
    if(en.locked)return [lockedPage(en,side)];
    const m=measure();
    const one=entryPage(en,side);m.appendChild(one);
    const t1=one.querySelector('.jtext');
    if(!t1.querySelector('.jbrk'))for(let fs=FIT_MAX;fs>=FIT_MIN;fs--){one.style.setProperty('--jfs',fs+'px');if(!over(t1))return [one];}
    one.remove();
    const queue=[...entryWords(en,el('div')).children];
    const out=[];let s=null;
    const next=()=>{
      s=entryShell(en,(out.length%2===0)===(side==='l')?'l':'r',!out.length);
      s.p.style.setProperty('--jfs',RUN_FS+'px');m.appendChild(s.p);entryEnd(s,en,false);out.push(s);
    };
    const words=()=>[...s.tx.children].filter(c=>!c.classList.contains('jph'));
    // a heading never ends a page: it goes over with what follows it
    const keepHeading=()=>{const w=words(),l=w[w.length-1];if(w.length>1&&l.classList.contains('jh')){s.tx.removeChild(l);queue.unshift(l);}};
    const run=()=>{
      while(queue.length){
        const b=queue.shift();
        if(b.classList.contains('jbrk')){if(words().length)next();continue;}
        s.tx.appendChild(b);
        if(!over(s.tx))continue;
        s.tx.removeChild(b);
        const [rest,some]=splitBlock(b,s.tx);
        if(!rest)continue;
        if(!some&&!words().length){s.tx.appendChild(rest);continue;}   // too big for any page: cut off
        queue.unshift(rest);keepHeading();next();
      }
    };
    next();
    // the ending (stickers, mug) takes room at the foot of the last page: what it pushes out goes over
    for(;;){
      run();
      entryEnd(s,en,true);
      if(!over(s.tx))break;
      while(over(s.tx)&&words().length>1){const w=words();const l=w[w.length-1];s.tx.removeChild(l);queue.unshift(l);}
      if(over(s.tx)&&words().length===1){
        const l=words()[0];s.tx.removeChild(l);
        const [rest,some]=splitBlock(l,s.tx);
        if(!some){s.tx.appendChild(rest||l);if(!queue.length)break;}
        else if(rest)queue.unshift(rest);
      }else if(queue.length){
        // the page has room again: as much of the first block pushed out as fits
        const l=queue.shift(),[rest]=splitBlock(l,s.tx);if(rest)queue.unshift(rest);
      }
      if(!queue.length)break;
      keepHeading();
      entryEnd(s,en,false);next();
    }
    out.forEach((x,k)=>{if(k)x.p.querySelector('.jcont').textContent=(en.title||'（无题）')+' · 续 '+(k+1)+'/'+out.length;});
    return out.map(x=>x.p);
  }
  // as much of block b as fits at the end of tx: a paragraph up to a sentence (a sentence longer than the
  // page, up to a character), a list or a comic strip up to an item. [what's left for the next page (null:
  // nothing), whether any of it went on this page]
  function splitBlock(b,tx){
    const items=b.matches('ul,ol,.jcomic');
    if(!items&&b.tagName!=='P')return [b,false];
    const parts=[];
    if(items)parts.push(...b.children);
    else b.childNodes.forEach(n=>{if(n.nodeType===3)(n.data.match(SENTENCE)||[n.data]).forEach(t=>parts.push(document.createTextNode(t)));else parts.push(n);});
    const head=b.cloneNode(false);tx.appendChild(head);
    let i=0;
    for(;i<parts.length;i++){head.appendChild(parts[i]);if(over(tx)){head.removeChild(parts[i]);break;}}
    if(!items&&i===0&&parts.length&&parts[0].nodeType===3){
      const t=parts[0].data,tn=document.createTextNode('');head.appendChild(tn);
      let lo=0,hi=t.length;
      while(lo<hi){const mid=(lo+hi+1)>>1;tn.data=t.slice(0,mid);if(over(tx))hi=mid-1;else lo=mid;}
      if(lo){tn.data=t.slice(0,lo);parts[0]=document.createTextNode(t.slice(lo));}else head.removeChild(tn);
    }
    const some=head.childNodes.length>0;
    if(!some)tx.removeChild(head);
    const left=parts.slice(i);
    if(!items)while(left.length&&(left[0].nodeName==='BR'||(left[0].nodeType===3&&!left[0].data.trim())))left.shift();
    if(!left.length)return [null,true];
    const rest=b.cloneNode(false);left.forEach(n=>rest.appendChild(n));
    if(b.tagName==='OL'&&some)rest.start=head.start+head.children.length;
    if(b.matches('.jcomic'))[head,rest].forEach(c=>{c.className=c.className.replace(/\bn\d\b/,'n'+Math.min(c.children.length,4));});
    return [rest,some];
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
  const svg16=(p,w)=>'<svg width="'+(w||18)+'" height="'+(w||18)+'" viewBox="0 0 16 16" aria-hidden="true">'+p+'</svg>';
  const SHARE_ICON='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 6.2H4a1.6 1.6 0 0 0-1.6 1.6v5.4A1.6 1.6 0 0 0 4 14.8h8a1.6 1.6 0 0 0 1.6-1.6V7.8A1.6 1.6 0 0 0 12 6.2h-1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10V1.6M5.2 4.2 8 1.4l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const RD_ICONS={
    out:svg16('<circle cx="6.8" cy="6.8" r="4.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
    in:svg16('<circle cx="6.8" cy="6.8" r="4.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14.5 14.5M4.6 6.8h4.4M6.8 4.6v4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
    x:svg16('<path d="M3.6 3.6l8.8 8.8M12.4 3.6l-8.8 8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  };
  function reader(nodes){
    nodes=nodes.filter(Boolean);
    if(!nodes.length||document.querySelector('.reader'))return;
    const back=document.activeElement;
    const box=el('div','reader');box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','放大看这一页');
    const sc=el('div','rd-scroll'),list=el('div','rd-pages');sc.tabIndex=0;sc.appendChild(list);
    // the bar: zoom out, how big (a tap: back to fitting the screen), zoom in | 分享 | close
    const btn=(cls,html,label)=>{const b=el('button','rd-btn'+(cls?' '+cls:''));b.type='button';b.innerHTML=html;b.setAttribute('aria-label',label);b.title=label;return b;};
    const bar=el('div','rd-bar'),out=btn('',RD_ICONS.out,'缩小'),lvl=btn('rd-lvl','1×','适合屏幕'),inn=btn('',RD_ICONS.in,'放大'),x=btn('rd-x',RD_ICONS.x,'关闭（Esc）');
    bar.append(out,lvl,inn,x);box.append(sc,bar);
    // 分享: a diary page's link for sharing (/p/<id>: chat apps show its card), by the phone's share sheet or copied
    const shared=sharable(nodes);
    if(shared&&!/^\/admin/.test(location.pathname)){
      const sb=btn('rd-share',SHARE_ICON,'分享这一页'),sl=el('span',null,'分享');sb.appendChild(sl);
      sb.onclick=()=>sharePage(shared,t=>{sl.textContent=t||'分享';});
      bar.insertBefore(el('span','rd-sep'),x);bar.insertBefore(sb,x);
    }
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
      lvl.textContent=ZOOMS[z]+'×';lvl.disabled=z===0;
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
    inn.onclick=()=>zoom(z+1);out.onclick=()=>zoom(z-1);lvl.onclick=()=>zoom(0);
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

  /* ---------- page sounds, for both books ----------
     Synthesised with WebAudio (no files to load): a paper rustle as a sheet turns and a soft flap as it lands;
     a heavier swing and a low thump for a cover. Silent until the reader first touches the page (browsers
     only allow audio after a gesture). Muted or not is remembered in localStorage, the same for both books. */
  const sound=(()=>{
    const KEY='techo-sound';
    let ctx=null,noise=null,master=null,on=true;
    try{on=localStorage.getItem(KEY)!=='off';}catch(e){}
    function audio(){
      if(ctx)return ctx;
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC)return null;
      ctx=new AC();
      master=ctx.createGain();master.gain.value=.9;master.connect(ctx.destination);
      // two seconds of soft (pinkish) noise, reused by every sound
      const len=ctx.sampleRate*2;noise=ctx.createBuffer(1,len,ctx.sampleRate);
      const d=noise.getChannelData(0);let b0=0,b1=0,b2=0;
      for(let i=0;i<len;i++){
        const w=Math.random()*2-1;
        b0=.997*b0+w*.029;b1=.985*b1+w*.032;b2=.95*b2+w*.048;
        d[i]=(b0+b1+b2+w*.05)*.9;
      }
      return ctx;
    }
    // call from a user gesture: creates / resumes the audio context
    function unlock(){if(!on)return;const c=audio();if(c&&c.state==='suspended')c.resume().catch(()=>{});}
    const soundOn=()=>on;
    function setSound(v){on=v;try{localStorage.setItem(KEY,v?'on':'off');}catch(e){}if(v)unlock();}
    function burst(t0,dur,o){
      const src=ctx.createBufferSource();src.buffer=noise;
      src.playbackRate.value=.9+Math.random()*.2;
      const f=ctx.createBiquadFilter();f.type=o.type||'bandpass';f.Q.value=o.q==null?.9:o.q;
      f.frequency.setValueAtTime(o.f0,t0);f.frequency.exponentialRampToValueAtTime(o.f1,t0+dur);
      const g=ctx.createGain(),at=o.at==null?.2:o.at;
      g.gain.setValueAtTime(.0001,t0);
      g.gain.exponentialRampToValueAtTime(o.peak,t0+dur*at);
      g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
      src.connect(f);f.connect(g);g.connect(master);
      src.start(t0,Math.random()*1.2,dur+.05);
    }
    const ready=()=>on&&ctx&&ctx.state==='running';
    // a paper sheet turning for `ms` (soft: finishing a drag, the rustle already happened under the hand)
    function paperTurn(ms,soft){
      if(!ready())return;
      const t=ctx.currentTime+.01,d=ms/1000;
      if(!soft)burst(t,d*.55,{f0:1400,f1:3800,q:.7,peak:.16,at:.35});                  // lifting off
      burst(t+d*.3,d*.55,{f0:3200,f1:1100,q:.6,peak:soft?.1:.13,at:.3});                // air through it
      burst(t+d*.86,.14,{f0:900,f1:500,q:.8,peak:.22,at:.12,type:'lowpass'});           // lands
    }
    // a cover swinging over and landing
    function boardTurn(ms){
      if(!ready())return;
      const t=ctx.currentTime+.01,d=ms/1000;
      burst(t,d*.8,{f0:500,f1:1400,q:.6,peak:.07,at:.5});
      const land=t+d*.93;
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='sine';o.frequency.setValueAtTime(120,land);o.frequency.exponentialRampToValueAtTime(48,land+.16);
      g.gain.setValueAtTime(.0001,land);g.gain.exponentialRampToValueAtTime(.5,land+.008);
      g.gain.exponentialRampToValueAtTime(.0001,land+.22);
      o.connect(g);g.connect(master);o.start(land);o.stop(land+.25);
      burst(land,.09,{f0:700,f1:300,q:.7,peak:.3,at:.08,type:'lowpass'});
    }
    // a dragged sheet let go and falling back
    function fallBack(ms){
      if(!ready())return;
      const t=ctx.currentTime+.01,d=ms/1000;
      burst(t+d*.75,.12,{f0:800,f1:450,q:.8,peak:.12,at:.15,type:'lowpass'});
    }
    // the first touch, key or wheel lets the sounds play (on the book's page: the admin has no use for them)
    if(document.getElementById('stage'))['pointerdown','keydown','wheel','touchend'].forEach(t=>addEventListener(t,unlock,{passive:true}));
    return {unlock,soundOn,setSound,paperTurn,boardTurn,fallBack};
  })();
  /* ♪ in the nav: turn the page sounds on and off */
  function soundButton(){
    const b=el('button','arrow sound');b.type='button';
    const show=()=>{const v=sound.soundOn();b.textContent='♪';b.setAttribute('aria-pressed',String(v));b.setAttribute('aria-label',v?'关闭翻页声':'打开翻页声');b.title=b.getAttribute('aria-label');};
    b.onclick=()=>{sound.setSound(!sound.soundOn());show();};
    show();return b;
  }

  /* the nav's button for it; pages(): the page nodes open now */
  // the nav's 封面 and 时间线: a closed book and a line of days, named for screen readers and on hover
  const CHIP_ICONS={
    cover:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 1.8h8.1a1.4 1.4 0 0 1 1.4 1.4v9.6a1.4 1.4 0 0 1-1.4 1.4H4.2a1.9 1.9 0 0 1-1.9-1.9V3.7a1.9 1.9 0 0 1 1.9-1.9Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.3 2v12.2M7.6 5.4h3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    map:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.6s-4.8-4.3-4.8-8A4.8 4.8 0 0 1 12.8 6.6c0 3.7-4.8 8-4.8 8Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="6.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    timeline:'<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.6 2v12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="1.6 2"/><circle cx="3.6" cy="3.6" r="1.7" fill="currentColor"/><circle cx="3.6" cy="8" r="1.7" fill="currentColor"/><circle cx="3.6" cy="12.4" r="1.7" fill="currentColor"/><path d="M7.4 3.6h6.2M7.4 8h4.6M7.4 12.4h5.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };
  // 足迹地图 in the nav, beside 时间线: a way out to /map/, once the journal has a Mapbox token (null without)
  function mapChip(){
    if(!site.mapboxToken)return null;
    const b=el('button','chip mapchip');b.type='button';b.innerHTML=CHIP_ICONS.map;
    b.setAttribute('aria-label','足迹地图');b.title='足迹地图';b.onclick=()=>{location.href='/map/';};
    return b;
  }
  function chipButton(label,icon,page){
    const b=el('button','chip');b.type='button';b.dataset.page=page;
    b.innerHTML=CHIP_ICONS[icon]||'';if(!CHIP_ICONS[icon])b.textContent=label;
    b.setAttribute('aria-label',label);b.title=label;
    return b;
  }
  /* The journal's settings the pages are drawn with (loadBook sets them; the admin's preview too). */
  let site={};
  function useSite(s){site=s||{};}
  /* Mapbox (手帐设置 → 地图): the GL library, loaded once when a map is wanted, and the little map on a
     page (a Static Images API picture, pinned where the page was written). Nothing without a token. */
  const MAPBOX_GL='https://api.mapbox.com/mapbox-gl-js/v3.31.0/';
  let glReady=null;
  function mapbox(token){
    if(!token)return Promise.reject(new Error('还没有配置 Mapbox token'));
    if(!glReady)glReady=new Promise((res,rej)=>{
      const css=document.createElement('link');css.rel='stylesheet';css.href=MAPBOX_GL+'mapbox-gl.css';document.head.appendChild(css);
      const s=document.createElement('script');s.src=MAPBOX_GL+'mapbox-gl.js';
      s.onload=()=>window.mapboxgl?res(window.mapboxgl):rej(new Error('Mapbox 没加载上'));
      s.onerror=()=>{glReady=null;rej(new Error('Mapbox 没加载上（网络？）'));};
      document.head.appendChild(s);
    });
    return glReady.then(gl=>{gl.accessToken=token;return gl;});
  }
  const night=()=>document.documentElement.getAttribute('data-theme')==='dark';
  /* 夜间书页: data-theme="dark" darkens the paper (paper.css). It follows the system's dark mode, unless the
     reader has chosen day or night with the nav's ☾/☀ (kept in this browser, 'techo-theme'; choosing what
     the system says goes back to following it), or the journal says off (then the paper stays as by day and
     there's no switch). data-theme="light" keeps even the desk light when the system is dark. A change while
     reading: the pages follow; the 'techo-theme' event tells a book to redraw. */
  const THEME_KEY='techo-theme';
  const themePref=()=>{try{const v=localStorage.getItem(THEME_KEY);return v==='dark'||v==='light'?v:null;}catch(e){return null;}};
  const sysDark=()=>!!(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
  let themeWatch=null,themeSite={};
  function applyTheme(){
    const root=document.documentElement,off=themeSite.nightPaper==='off',p=off?null:themePref(),sys=sysDark();
    const dark=p?p==='dark':!off&&sys,was=night();
    const attr=dark?'dark':p==='light'&&sys?'light':null;
    if(attr)root.setAttribute('data-theme',attr);else root.removeAttribute('data-theme');
    if(dark!==was){
      // the little maps on the pages: the map of the other hour
      document.querySelectorAll('.jmap img').forEach(i=>{i.src=i.src.replace(/\/(light|dark)-v11\//,'/'+mapStyle()+'/');});
      document.dispatchEvent(new Event('techo-theme'));
    }
    return dark!==was;
  }
  function nightTheme(S){
    themeSite=S||{};applyTheme();
    const mq=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');
    if(mq&&mq.addEventListener&&!themeWatch){themeWatch=()=>applyTheme();mq.addEventListener('change',themeWatch);}
  }
  const SUN=svg16('<circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.2v1.7M8 13.1v1.7M1.2 8h1.7M13.1 8h1.7M3.2 3.2l1.2 1.2M11.6 11.6l1.2 1.2M3.2 12.8l1.2-1.2M11.6 4.4l1.2-1.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',16);
  const MOON=svg16('<path d="M13.4 10.2A5.9 5.9 0 0 1 5.8 2.6a5.9 5.9 0 1 0 7.6 7.6Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',16);
  // ☾ / ☀: night or day for this reader (none when the journal has 夜间书页 off)
  function themeButton(cls){
    if(themeSite.nightPaper==='off')return null;
    const b=el('button',cls||'arrow theme');b.type='button';
    const paint=()=>{const d=night();b.innerHTML=d?SUN:MOON;const t=d?'换成白天的纸':'换成夜间的纸';b.setAttribute('aria-label',t);b.title=t;};
    b.onclick=()=>{
      const want=night()?'light':'dark';
      try{if((want==='dark')===sysDark())localStorage.removeItem(THEME_KEY);else localStorage.setItem(THEME_KEY,want);}catch(e){}
      themeSwitch(b,()=>{applyTheme();paint();const i=b.querySelector('svg');if(i)i.classList.add('th-in');});
    };
    document.addEventListener('techo-theme',paint);
    paint();return b;
  }
  /* The switch, animated: the other hour spreads out from the button in a widening circle, like a lamp
     switched on or off (a view transition); where there are none, the colours ease across; with reduced
     motion, it's simply done. The icon turns as it changes. */
  const THEME_CSS='::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}'+
    '::view-transition-new(root){z-index:2}::view-transition-old(root){z-index:1}'+
    '.th-in{animation:th-in .55s cubic-bezier(.3,1.4,.5,1) both}@keyframes th-in{from{transform:rotate(-100deg) scale(.3);opacity:0}}'+
    'html.th-fade,html.th-fade *{transition:background-color .45s ease,color .45s ease,border-color .45s ease,fill .45s ease,stroke .45s ease!important}'+
    '.th-veil{position:fixed;inset:0;z-index:9999;pointer-events:none;transition:clip-path .5s cubic-bezier(.45,0,.2,1),opacity .35s ease}'+
    '@media (prefers-reduced-motion:reduce){.th-in{animation:none}}';
  function themeSwitch(from,change){
    if(!document.getElementById('th-css')){const st=document.createElement('style');st.id='th-css';st.textContent=THEME_CSS;document.head.appendChild(st);}
    const root=document.documentElement;
    if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){change();return;}
    const r=from.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const R=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
    // The 3D book can't be pictured by a view transition (its live pages are 3D-transformed over a WebGL
    // canvas, which the snapshot misses), nor can a Mapbox map (/map/, WebGL too): there a veil of the other hour's desk spreads out from the button,
    // the switch happens under it, and it lifts.
    if(document.body.classList.contains('is-3d')||document.querySelector('.mapboxgl-canvas')){
      const v=el('div','th-veil'),at=' at '+x+'px '+y+'px)';
      v.style.background=night()?'#e8e6e1':'#1e1f22';v.style.clipPath='circle(0px'+at;
      document.body.appendChild(v);v.getBoundingClientRect();
      v.style.clipPath='circle('+R+'px'+at;
      setTimeout(()=>{
        change();
        requestAnimationFrame(()=>requestAnimationFrame(()=>{v.style.opacity='0';setTimeout(()=>v.remove(),400);}));
      },520);
      return;
    }
    if(!document.startViewTransition){
      root.classList.add('th-fade');change();
      clearTimeout(themeSwitch.t);themeSwitch.t=setTimeout(()=>root.classList.remove('th-fade'),500);
      return;
    }
    const vt=document.startViewTransition(change);
    vt.ready.then(()=>{
      root.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+R+'px at '+x+'px '+y+'px)']},
        {duration:650,easing:'cubic-bezier(.45,0,.2,1)',pseudoElement:'::view-transition-new(root)'});
    }).catch(()=>{});
  }
  const mapStyle=()=>night()?'dark-v11':'light-v11';
  function geoOf(en){const m=/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec((en&&en.geo)||'');return m?[+m[1],+m[2]]:null;}
  function staticMap(la,lo,w,h,zoom){
    return 'https://api.mapbox.com/styles/v1/mapbox/'+mapStyle()+'/static/pin-s+d9573b('+lo+','+la+')/'+lo+','+la+','+(zoom||12)+',0/'+w+'x'+h+'@2x?logo=false&attribution=false&access_token='+encodeURIComponent(site.mapboxToken);
  }
  // the little map on a page: a snapshot taped on like a photo, the place under it (and whose map it is)
  function pageMap(en){
    const g=geoOf(en);
    if(!g||!site.mapboxToken||site.mapOnPage==='hide')return null;
    const f=el('figure','jph jmap'),img=el('img');
    img.alt=en.place?'地图：'+en.place:'地图';img.decoding='async';img.loading='lazy';img.src=staticMap(g[0],g[1],180,135);
    f.append(el('div','tape'),img,el('figcaption','cap',en.place||''),el('small','jmap-by','© Mapbox © OSM'));
    f.style.setProperty('--tilt','2.5deg');
    return f;
  }

  /* the cover styles (手帐设置 → 封面款式): a cv-<key> class on the covers and endpapers, their colours in
     book-extra.css. slate is the built-in one (no class). */
  const COVERS={slate:'石板青布面',kraft:'牛皮纸',leather:'黑皮烫金',linen:'米白亚麻',wine:'酒红绒面'};
  function coverStyle(node,key){
    Object.keys(COVERS).forEach(k=>node.classList.remove('cv-'+k));
    if(COVERS[key]&&key!=='slate')node.classList.add('cv-'+key);
  }
  /* the paper (手帐设置 → 纸张): its pattern (pp-<key>) and colour (pt-<key>), in book-extra.css. 方格 and
     米白 are the built-in ones (no class). */
  const PAPERS={grid:'方格',lined:'横线',dots:'点阵',plain:'空白'};
  const TONES={cream:'米白',white:'雪白',aged:'旧黄',mint:'薄荷'};
  function paperStyle(node,pattern,tone){
    Object.keys(PAPERS).forEach(k=>node.classList.remove('pp-'+k));
    Object.keys(TONES).forEach(k=>node.classList.remove('pt-'+k));
    if(PAPERS[pattern]&&pattern!=='grid')node.classList.add('pp-'+pattern);
    if(TONES[tone]&&tone!=='cream')node.classList.add('pt-'+tone);
  }
  /* 分享 a diary page: its link for sharing (/p/<id>: chat apps show its card, title and first words), by the
     phone's share sheet, else copied. say(text) shows how it went, say() puts the button back. */
  const sharable=nodes=>nodes.find(n=>n&&n.dataset&&n.dataset.id&&n.classList.contains('jp')&&!n.classList.contains('locked'))||null;
  async function sharePage(node,say){
    const url=location.origin+'/p/'+node.dataset.id,h=node.querySelector('h2,.jcont'),title=h?h.textContent:document.title;
    if(navigator.share){try{await navigator.share({title,url});}catch(e){}return;}
    try{await navigator.clipboard.writeText(url);say('已复制链接');}catch(e){say(url);}
    setTimeout(()=>say(),1800);
  }
  // the nav's 分享: the diary page in view (on the cover, the timeline, a sample page … there's none: greyed)
  function shareButton(pages){
    const b=el('button','arrow share');b.type='button';
    const icon=SHARE_ICON;b.innerHTML=icon;
    b.setAttribute('aria-label','分享这一页');b.title='分享这一页（发到微信、Telegram 会带预览卡片）';
    b.sync=()=>{b.disabled=!sharable(pages());};
    b.onclick=()=>{const n=sharable(pages());if(n)sharePage(n,t=>{if(t){b.textContent=t;b.classList.add('said');}else{b.innerHTML=icon;b.classList.remove('said');}});};
    return b;
  }
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
        a.href=r.id?'#e-'+r.id:'#'+r.date;      // that very page, even on a day with several
        a.append(el('span','tlp-d',String(d.mo).padStart(2,'0')+'.'+String(d.d).padStart(2,'0')),el('span','tlp-w',WD[d.wd]),el('span','tlp-t',r.title),el('span','tlp-go','›'));
        a.setAttribute('aria-label',d.mo+'月'+d.d+'日 '+r.title+'，翻到这一天');
        list.appendChild(a);
      });
      const f=el('footer','foot');
      // the same days as cards, with their words, doodles and photos: the timeline page (/timeline/)
      const all=el('a','tlp-all','整页看 →');all.href='/timeline/';
      const left=el('span');left.append('点一行，翻到那一天 · ',all);
      // where they were written: the map page (/map/), when there's a Mapbox token
      if(site.mapboxToken){const mp=el('a','tlp-all','地图 →');mp.href='/map/';left.append(' · ',mp);}
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
    // 复制 on 写信给我: the address to the clipboard, in either book (放大看's copy presses this one); where the
    // clipboard is refused, the address is selected for Ctrl+C
    const copyBtn=src.querySelector('#copyBtn');
    if(copyBtn&&mail)copyBtn.addEventListener('click',ev=>{
      ev.stopPropagation();
      const done=()=>{copyBtn.textContent='已复制';setTimeout(()=>{copyBtn.textContent='复制';},1600);};
      const sel=()=>{const r=document.createRange();r.selectNodeContents(mail);const s=getSelection();s.removeAllRanges();s.addRange(r);copyBtn.textContent='已选中，按 Ctrl+C';};
      try{navigator.clipboard.writeText(mail.textContent.trim()).then(done,sel);}catch(err){sel();}
    });
    const gh=src.querySelector('#gh');
    if(gh){const ok=/^https:\/\//i.test(settings.github||'');gh.href=ok?settings.github:'https://github.com/';
      gh.textContent=settings.githubText||(ok?settings.github.replace(/^https:\/\//i,''):'github.com/你的用户名');}
    useSite(settings);
    nightTheme(settings);
    applySettings(settings);
    // wait for the handwriting fonts so text fitting measures the real glyphs
    if(document.fonts&&document.fonts.ready)await Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,2500))]);

    /* the book's own words and pictures, from the admin's 手帐设置. Missing keys keep the built-in page. */
    function applySettings(S){
      const has=k=>typeof S[k]==='string',one=s=>src.querySelector(s),list=v=>v.split(',').filter(Boolean);
      if(has('siteTitle')&&S.siteTitle)document.title=S.siteTitle;
      // 封面款式: the covers and the endpapers wear it (book-extra.css), the 3D boards follow them
      if(has('coverStyle')&&COVERS[S.coverStyle])src.querySelectorAll('.page.cover,.page.backcover,.page.inside').forEach(n=>coverStyle(n,S.coverStyle));
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
      const d=parseDate(en.date);
      // id: the diary page's own link (#e-<id>), for a day with more than one page. A page written on over
      // several (cont: the ones after its first) links, and is on the 时间线, by its first.
      entryPages(en,leftNext()?'l':'r').forEach((node,k)=>{
        push(node,{label:k===0&&leftNext()&&d?(d.mo+'/'+d.d):null,date:d?en.date:null,id:en.id,cont:k>0});
      });
    });
    // the timeline, after the flyleaf: its pages come in pairs, so every page after it keeps its side
    const dated=pages.slice(tlAt).map((p,i)=>p.date&&!p.sample&&!p.cont&&{date:p.date,id:p.id,order:i,locked:p.node.classList.contains('locked'),
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
    // 纸张: every paper page wears the paper's pattern and colour; the page itself (the slips, the flip book's
    // backing) takes the colour too
    pages.forEach(p=>{if(!p.hard)paperStyle(p.node,settings.paperStyle,settings.paperTone);});
    paperStyle(document.documentElement,null,settings.paperTone);
    return {pages,settings,lock};
  }
  const stickerList=Object.keys(STICKERS).map(k=>({key:k,label:STICKERS[k][0]}));
  /* the "drag the corner" note beside the cover: fades and drifts away when the book opens (or a corner is
     taken), and once the reader has opened the book it has done its job: it doesn't come back on the cover */
  function dragNote(el,show){
    if(!el)return;
    clearTimeout(el.__t);
    if(show){el.hidden=false;el.dataset.shown='1';requestAnimationFrame(()=>el.classList.remove('gone'));}
    else if(!el.hidden){el.classList.add('gone');el.__t=setTimeout(()=>{el.hidden=true;},600);}
  }
  window.Techo={askUnlock,relock,keys,dragNote,loadBook,stickerList,stickerSvg,el,parseDate,todayStr,sortEntries,makeCal,mugSvg,entryPage,entryPages,blankPage,fitText,measure,prepDraw,playDraw,reader,readerButton,shareButton,mapChip,themeButton,chipButton,useSite,nightTheme,mapbox,geoOf,COVERS,coverStyle,PAPERS,TONES,paperStyle,dayPicker,sound,soundButton,bodyBlocks,plainText,meting,neteaseId,METING_DEFAULT};
})();
