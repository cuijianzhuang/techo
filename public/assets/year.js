/* The year in review (/year/?y=2026): a year of the diary at a glance. The figures (pages, days, the longest run of
   days, characters), the writing calendar (a square a day) and a column a month, then what the year held: places,
   books, films and music, tickets, money, the doodles drawn most, the first, last and longest page. From the pages a
   reader can see: a locked page they haven't opened counts as a page and a day, and gives nothing else away. */
(async function(){
  "use strict";
  const T=window.Techo,K=window.Keep,{el,parseDate}=T;
  const box=document.getElementById('book'),stat=document.getElementById('stat');

  /* ---------- the year's numbers (yearStats: tests/year.test.mjs runs it) ---------- */
  const pad=n=>String(n).padStart(2,'0');
  const dayNo=d=>Math.round(Date.parse(d+'T00:00:00Z')/864e5);
  /** everything the page shows of year `y`, from `entries` (the reader's: locked ones only their date) */
  function yearStats(entries,y){
    const all=(entries||[]).filter(en=>en&&/^\d{4}-\d{2}-\d{2}$/.test(en.date||'')&&+en.date.slice(0,4)===y);
    const open=all.filter(en=>!en.locked);
    const perDay=new Map();all.forEach(en=>perDay.set(en.date,(perDay.get(en.date)||0)+1));
    const days=[...perDay.keys()].sort();
    // the longest run of days written on, one after another
    let best={len:0,from:'',to:''},run=null;
    days.forEach(d=>{
      if(run&&dayNo(d)===dayNo(run.to)+1){run.to=d;run.len++;}else run={len:1,from:d,to:d};
      if(run.len>best.len)best={...run};
    });
    const months=Array(12).fill(0);all.forEach(en=>months[+en.date.slice(5,7)-1]++);
    const weekdays=Array(7).fill(0);all.forEach(en=>weekdays[new Date(en.date+'T00:00:00Z').getUTCDay()]++);
    const chars=new Map();open.forEach(en=>chars.set(en,[...T.plainText(en.body||'')].length));
    const words=[...chars.values()].reduce((a,b)=>a+b,0);
    let longest=null;chars.forEach((n,en)=>{if(!longest||n>longest.n)longest={n,en};});
    const count=(list,key)=>{const m=new Map();list.forEach(k=>{if(k)m.set(k,(m.get(k)||0)+1);});return [...m.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));};
    const places=count(open.map(en=>String(en.place||'').trim()));
    const cities=count(open.map(en=>String(en.place||'').split(/\s*[·・]\s*/)[0].trim()));
    const stickers=count(open.flatMap(en=>en.stickers||[]));
    const photos=open.reduce((a,en)=>a+((en.photos&&en.photos.length)||(en.photoKey?1:0)),0);
    // what was stuck in the pages: one book (film, song) per title and who by, as the shelf counts them
    const things={book:new Map(),film:new Map(),music:new Map()},tickets={flight:0,train:0,cinema:0};
    let spent=0,bills=0;
    open.forEach(en=>T.cardsOf(en.body||'').forEach(c=>{
      if(things[c.kind]){
        const f=T.ticketFields(c.lines),name=String(f.title||T.neteaseId(f.netease||f.link)||'').trim();
        if(name){const k=name.toLowerCase()+'|'+String(f.author||f.artist||f.director||'').trim().toLowerCase();if(!things[c.kind].has(k))things[c.kind].set(k,{name,en});}
      }else if(c.kind in tickets)tickets[c.kind]++;
      else if(c.kind==='receipt'){spent+=K.bill(c.lines).total;bills++;}
    }));
    const sorted=T.sortEntries(open);
    return {
      year:y,pages:all.length,locked:all.length-open.length,days:days.length,perDay,streak:best,months,weekdays,words,photos,
      longest:longest&&longest.n?{id:longest.en.id,title:longest.en.title||'（无题）',chars:longest.n}:null,
      first:sorted[0]?{id:sorted[0].id,date:sorted[0].date,title:sorted[0].title||'（无题）'}:null,
      last:sorted.length?{id:sorted[sorted.length-1].id,date:sorted[sorted.length-1].date,title:sorted[sorted.length-1].title||'（无题）'}:null,
      places,cities,stickers,
      books:[...things.book.values()].map(t=>t.name),films:[...things.film.values()].map(t=>t.name),music:[...things.music.values()].map(t=>t.name),
      tickets,spent:Math.round(spent*100)/100,bills,
    };
  }
  /** the years there are pages for, newest first */
  const yearsOf=entries=>[...new Set((entries||[]).map(en=>+String(en.date||'').slice(0,4)).filter(y=>y>1900))].sort((a,b)=>b-a);
  /* ---------- drawing ---------- */

  let entries,settings;
  try{
    const held=T.keys();
    const [e,s]=await Promise.all([
      fetch('/api/entries',{headers:{accept:'application/json','x-techo-keys':Object.values(held).join(' ')}}).then(r=>{if(!r.ok)throw new Error('entries '+r.status);return r.json();}),
      fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    entries=e.entries||[];settings=(s&&s.settings)||{};
  }catch(err){console.warn('techo year:',err);K.say(box,'暂时翻不开这一年，过一会儿再来。<br><a href="/">回到手帐</a>');return;}
  T.useSite(settings);T.nightTheme(settings);T.applyBookFont(settings);
  {const t=T.themeButton('theme-sw');if(t)document.body.appendChild(t);}
  if(settings.siteTitle)document.title='年度回顾 · '+settings.siteTitle;

  const years=yearsOf(entries);
  if(!years.length){K.say(box,'手帐里还没有写过的页。<br><a href="/admin/">去写第一页</a>');return;}
  const asked=+new URLSearchParams(location.search).get('y'),thisYear=new Date().getFullYear();
  let year=years.includes(asked)?asked:years.includes(thisYear)?thisYear:years[0];

  const WD='日一二三四五六',fmt=d=>d.replace(/-/g,'.');
  const num=n=>n.toLocaleString('zh-CN');
  const money=v=>'¥'+(Math.round(v*100)/100).toLocaleString('zh-CN',{maximumFractionDigits:2});
  const link=(r,text)=>{const a=el('a',null,text||r.title);a.href='/#e-'+r.id;return a;};
  const tip=el('div','yr-tip');tip.hidden=true;tip.setAttribute('role','status');
  const showTip=(target,within,parts)=>{
    tip.textContent='';parts.forEach((p,i)=>tip.append(i?el('span',null,' · '+p):el('b',null,p)));
    tip.hidden=false;within.appendChild(tip);
    const r=target.getBoundingClientRect(),pr=within.getBoundingClientRect();
    tip.style.left=Math.max(0,Math.min(pr.width-tip.offsetWidth,r.left-pr.left+within.scrollLeft+r.width/2-tip.offsetWidth/2))+'px';
    tip.style.top=(r.top-pr.top-tip.offsetHeight-6)+'px';
  };
  const hideTip=()=>{tip.hidden=true;};

  function draw(){
    const st=yearStats(entries,year);
    stat.textContent=years.length>1?'写过的年份：'+years.join('、'):'';
    box.textContent='';
    // the years
    if(years.length>1){
      const tabs=el('div','kp-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','哪一年');
      years.forEach(y=>{const b=el('button',null,y+' 年');b.type='button';b.setAttribute('aria-pressed',String(y===year));
        b.onclick=()=>{year=y;history.replaceState(null,'','?y='+y);draw();};tabs.appendChild(b);});
      box.appendChild(tabs);
    }
    // the figures
    const tiles=el('section','bl-tiles');
    const tile=(label,value,note,hero)=>{const t=el('div','bl-tile'+(hero?' hero':''));t.append(el('span','bl-label',label),el('b','bl-value',value));if(note)t.appendChild(el('span','bl-note',note));return t;};
    tiles.append(
      tile(year+' 年写了',num(st.pages)+' 页',st.locked?'其中 '+st.locked+' 页上了锁':(st.first?'从 '+fmt(st.first.date)+' 起':''),true),
      tile('写过的日子',num(st.days)+' 天',st.streak.len>1?'最长连续 '+st.streak.len+' 天（'+fmt(st.streak.from).slice(5)+'–'+fmt(st.streak.to).slice(5)+'）':''),
      tile('一共写了',num(st.words)+' 字',st.photos?'贴了 '+st.photos+' 张照片':''));
    box.appendChild(tiles);

    // the calendar: a square a day
    const cal=el('section','bl-chart');
    {const h=el('h2','kp-year','每一天');h.appendChild(el('small',null,'颜色越深，那天写得越多'));cal.appendChild(h);}
    const wrap=el('div','yr-cal'),grid=el('div','yr-weeks');
    const start=Date.UTC(year,0,1),startWd=(new Date(start).getUTCDay()+6)%7;   // Monday first
    const dayCount=(Date.UTC(year+1,0,1)-start)/864e5,weeks=Math.ceil((startWd+dayCount)/7);
    grid.style.gridTemplateColumns='auto repeat('+weeks+',12px)';
    // weekday labels (一 三 五), then a column a week
    grid.appendChild(el('span'));
    ['一','','三','','五','',''].forEach((w,i)=>{const s=el('span','yr-wd',w);s.style.gridRow=String(i+2);grid.appendChild(s);});
    for(let i=0;i<dayCount;i++){
      const t=new Date(start+i*864e5),d=t.getUTCFullYear()+'-'+pad(t.getUTCMonth()+1)+'-'+pad(t.getUTCDate());
      const col=Math.floor((startWd+i)/7)+2,row=(startWd+i)%7+2,n=st.perDay.get(d)||0;
      // a month's name over the week its first day is in
      if(t.getUTCDate()===1){const m=el('span','yr-mo',(t.getUTCMonth()+1)+'月');m.style.gridColumn=col+' / span 3';grid.appendChild(m);}
      const lvl=n>=4?4:n;
      const c=el(n?'a':'span','yr-day'+(lvl?' l'+lvl:''));
      c.style.gridColumn=String(col);c.style.gridRow=String(row);
      const label=(t.getUTCMonth()+1)+'月'+t.getUTCDate()+'日 周'+WD[t.getUTCDay()]+(n?'，写了 '+n+' 页':'，没写');
      c.setAttribute('aria-label',label);
      if(n){c.href='/#'+d;}
      const parts=[n?n+' 页':'没写',(t.getUTCMonth()+1)+'月'+t.getUTCDate()+'日 周'+WD[t.getUTCDay()]];
      c.addEventListener('pointerenter',()=>showTip(c,wrap,parts));c.addEventListener('focus',()=>showTip(c,wrap,parts));
      c.addEventListener('pointerleave',hideTip);c.addEventListener('blur',hideTip);
      grid.appendChild(c);
    }
    wrap.appendChild(grid);cal.appendChild(wrap);
    const lg=el('div','yr-legend');lg.append('少');
    ['--y0','--y1','--y2','--y3','--y4'].forEach((v,i)=>{const s=el('i');s.style.background='var('+v+')';s.title=['没写','1 页','2 页','3 页','4 页及以上'][i];lg.appendChild(s);});
    lg.append('多　·　点一天翻到那一页');cal.appendChild(lg);
    box.appendChild(cal);

    // a column a month
    const chart=el('section','bl-chart');
    {const h=el('h2','kp-year','每个月');h.appendChild(el('small',null,'写了几页'));chart.appendChild(h);}
    const max=Math.max(...st.months,1);
    const niceStep=v=>{const p=Math.pow(10,Math.floor(Math.log10(v||1))),f=v/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;};
    const step=Math.max(1,niceStep(max/4)),top=Math.ceil(max/step)*step;
    const plot=el('div','bl-plot'),axis=el('div','bl-axis'),cols=el('div','bl-cols');
    for(let v=top;v>=0;v-=step){const g=el('div','bl-grid');g.style.bottom=(v/top*100)+'%';g.appendChild(el('span',null,String(v)));axis.appendChild(g);}
    const peak=st.months.indexOf(Math.max(...st.months));
    st.months.forEach((v,i)=>{
      const c=el('button','bl-col');c.type='button';c.setAttribute('aria-label',(i+1)+'月，'+v+' 页');
      const bar=el('i','bl-bar');bar.style.height=(v/top*100)+'%';if(!v)bar.classList.add('none');
      c.append(bar,el('span','bl-mo',(i+1)+'月'));
      // the busiest month says its number on its cap; the others on hover
      if(v&&i===peak){const lab=el('span','yr-cap',String(v));lab.style.cssText='position:absolute;left:0;right:0;text-align:center;bottom:calc('+(v/top*100)+'% + 4px);font:500 11px/1 var(--print);color:var(--desk-strong);font-variant-numeric:tabular-nums';c.appendChild(lab);}
      const parts=[v+' 页',year+' 年 '+(i+1)+' 月'];
      c.addEventListener('pointerenter',()=>showTip(c,plot,parts));c.addEventListener('focus',()=>showTip(c,plot,parts));
      c.addEventListener('pointerleave',hideTip);c.addEventListener('blur',hideTip);
      c.onclick=()=>{const f=T.sortEntries(entries.filter(en=>en.date.slice(0,7)===year+'-'+pad(i+1)))[0];if(f)location.href='/#'+f.date;};
      cols.appendChild(c);
    });
    plot.append(axis,cols);chart.appendChild(plot);
    // the same numbers, without a chart
    const tbl=el('details','bl-table');tbl.appendChild(el('summary',null,'按月看数字'));
    {const t=el('table');const hr=el('tr');['月份','页数'].forEach(h=>hr.appendChild(el('th',null,h)));t.appendChild(hr);
      st.months.forEach((v,i)=>{const r=el('tr');r.append(el('td',null,(i+1)+' 月'),el('td',null,String(v)));t.appendChild(r);});tbl.appendChild(t);}
    chart.appendChild(tbl);
    box.appendChild(chart);

    // what the year held
    const facts=el('section','yr-facts');
    const fact=(title,...nodes)=>{const f=el('div','yr-fact');f.appendChild(el('h3',null,title));nodes.filter(Boolean).forEach(n=>f.appendChild(n));facts.appendChild(f);};
    const big=(n,unit)=>{const b=el('div','yr-big',String(n));if(unit)b.appendChild(el('small',null,unit));return b;};
    const line=(...xs)=>{const p=el('div','yr-line');p.append(...xs);return p;};
    const muted=t=>el('span','yr-muted',t);
    const chips=(list,most)=>{const c=el('div','yr-chips');list.slice(0,most).forEach(([k,n])=>{const s=el('span',null,k);if(n>1)s.appendChild(el('b',null,'×'+n));c.appendChild(s);});return c;};
    if(st.places.length)fact('去过的地方',big(st.cities.length,'个城市 · '+st.places.length+' 个地方'),chips(st.places,8));
    const reads=[[st.books,'本书','读了'],[st.films,'部片','看了'],[st.music,'首歌','听了']].filter(([l])=>l.length);
    if(reads.length)fact('书、电影和音乐',big(reads.map(([l,u])=>l.length+' '+u).join(' · ')),...reads.map(([l,,v])=>line(muted(v+'：'),l.slice(0,8).join('、')+(l.length>8?' ……':''))));
    const tk=[['flight','趟飞机'],['train','趟火车'],['cinema','场电影']].filter(([k])=>st.tickets[k]);
    if(tk.length)fact('票根',big(tk.map(([k,u])=>st.tickets[k]+' '+u).join(' · ')),line(muted('都夹在'),(()=>{const a=el('a',null,'票夹');a.href='/tickets/';return a;})(),muted('里')));
    if(st.bills)fact('花了多少',big(money(st.spent)),line(muted(st.bills+' 张小票 · 平均每张 '+money(st.spent/st.bills)+'，细账在'),(()=>{const a=el('a',null,'账本');a.href='/bills/';return a;})()));
    if(st.stickers.length){
      const row=el('div','yr-stk');
      st.stickers.slice(0,4).forEach(([k,n])=>{const f=el('figure');f.append(T.stickerSvg(k,46),el('figcaption',null,'×'+n));row.appendChild(f);});
      fact('最常画的小插画',row);
    }
    {const w=st.weekdays.indexOf(Math.max(...st.weekdays));
      fact('最常写的日子',big('周'+WD[w],st.weekdays[w]+' 页'),line(muted('一周七天：'+st.weekdays.map((n,i)=>'周'+WD[i]+' '+n).slice(1).concat('周日 '+st.weekdays[0]).join(' · '))));}
    if(st.first){
      const nodes=[line(muted('第一页　'),link(st.first),muted('　'+fmt(st.first.date)))];
      if(st.last&&st.last.id!==st.first.id)nodes.push(line(muted('最近一页　'),link(st.last),muted('　'+fmt(st.last.date))));
      if(st.longest)nodes.push(line(muted('写得最长的　'),link(st.longest),muted('　'+num(st.longest.chars)+' 字')));
      fact('这一年的几页',...nodes);
    }
    box.appendChild(facts);

    // share it
    const bar=el('div');bar.style.cssText='margin:22px 0 0;display:flex;gap:10px;align-items:center';
    const sh=el('button','yr-share','分享这一年');sh.type='button';const said=el('span','yr-muted');
    sh.onclick=async()=>{
      const url=location.origin+'/year/?y='+year,title=(settings.siteTitle||'手帐')+' · '+year+' 年';
      if(navigator.share){try{await navigator.share({title,url});}catch(e){}return;}
      try{await navigator.clipboard.writeText(url);said.textContent='已复制链接';}catch(e){said.textContent=url;}
      setTimeout(()=>{said.textContent='';},2000);
    };
    bar.append(sh,said);box.appendChild(bar);
  }
  draw();
  window.TechoYear={yearStats};
})();
