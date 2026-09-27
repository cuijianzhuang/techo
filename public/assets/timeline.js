/* The timeline (/timeline/): every diary page written from the admin, newest first, a month at a time. Each
   day opens the book at that page (/#YYYY-MM-DD). Pages come from /api/entries with the keys this tab holds,
   so a locked page the reader has opened shows; one they haven't shows only its date, sealed. */
(async function(){
  "use strict";
  const T=window.Techo,{el,parseDate}=T;
  const WD=['日','一','二','三','四','五','六'],WDE=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const MOE=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sept.','Oct.','Nov.','Dec.'];
  const list=document.getElementById('tl'),stat=document.getElementById('stat');
  const dot=s=>s.replace(/-/g,'.');
  function say(text,link){
    list.textContent='';
    const p=el('p','tl-msg',text);
    if(link){p.appendChild(document.createElement('br'));const a=el('a',null,link);a.href='/';p.appendChild(a);}
    list.appendChild(p);
  }

  const held=T.keys();
  let entries,settings={};
  try{
    const [e,s]=await Promise.all([
      fetch('/api/entries',{headers:{accept:'application/json','x-techo-keys':Object.values(held).join(' ')}}).then(r=>{if(!r.ok)throw new Error('entries '+r.status);return r.json();}),
      fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    entries=(e.entries||[]).filter(en=>parseDate(en.date));
    settings=(s&&s.settings)||{};
  }catch(err){
    console.warn('techo timeline:',err);
    say('暂时翻不开手帐，过一会儿再来。','回到手帐');
    return;
  }
  if(settings.siteTitle)document.title='时间线 · '+settings.siteTitle;
  T.paperStyle(document.documentElement,settings.paperStyle,settings.paperTone);   // 纸张: the cards are the book's paper
  T.nightTheme(settings);                                                           // (evening paper in dark mode)
  // where they were written: the map page, when the journal has a Mapbox token
  if(settings.mapboxToken){const a=el('a','tl-back','足迹地图 →');a.href='/map/';a.style.marginLeft='14px';document.querySelector('.tl-back').after(a);}
  if(!entries.length){say('还没有写下的日子。','去手帐看看');return;}

  entries=T.sortEntries(entries).reverse();
  const days=new Set(entries.map(en=>en.date));
  stat.textContent='共 '+entries.length+' 页'+(days.size!==entries.length?'，'+days.size+' 天':'')+' · '+dot(entries[entries.length-1].date)+' → '+dot(entries[0].date);

  const today=T.todayStr();
  function card(en){
    const d=parseDate(en.date),we=d.wd===0||d.wd===6;
    const a=el('a','tl-card'+(en.locked?' locked':''));a.href='/#e-'+en.id;   // that very page, even on a day with several
    const date=el('div','tl-date'+(we?' we':''));
    date.append(el('b',null,String(d.d).padStart(2,'0')),el('span','wd',WD[d.wd]),el('i',null,WDE[d.wd]));
    const main=el('div','tl-main'),h=el('h3');
    main.appendChild(h);
    a.append(date,main);
    if(en.locked){
      h.textContent='上了锁的一页';
      main.appendChild(el('p','tl-ex',en.locked==='book'?'整本手帐上了锁，翻到这里输入口令就能看。':'这一天上了锁，翻到这里输入口令就能看。'));
      const seal=el('div','tl-seal','锁');seal.setAttribute('aria-hidden','true');a.appendChild(seal);
    }else{
      h.textContent=en.title||'（无题）';
      if(en.stamp){const st=el('span','tl-stamp',[...en.stamp][0]);st.setAttribute('aria-hidden','true');h.appendChild(st);}
      if(en.latin)main.appendChild(el('div','tl-latin',en.latin));
      const pw=[en.place,en.weather].filter(Boolean).join(' · ');
      if(pw)main.appendChild(el('div','tl-meta',pw));
      const ex=T.plainText(en.body);
      if(ex)main.appendChild(el('p','tl-ex',ex));
      const stk=(en.stickers||[]).map(k=>T.stickerSvg(k,30)).filter(Boolean);
      if(stk.length){const r=el('div','tl-stk');r.setAttribute('aria-hidden','true');stk.forEach(s=>r.appendChild(s));main.appendChild(r);}
      if(en.photoUrl||en.photoKey){
        const k=en.lock&&held[en.lock];
        const ph=el('figure','tl-ph'),img=el('img');
        img.src=en.photoUrl||('/img/'+en.photoKey+(k?'?k='+encodeURIComponent(k):''));
        img.alt=en.photoCap||'';img.loading='lazy';img.decoding='async';
        ph.appendChild(img);a.appendChild(ph);
      }
    }
    if(en.date===today){const t=el('span','tl-today','今天');h.appendChild(t);}
    a.setAttribute('aria-label',d.mo+'月'+d.d+'日 星期'+WD[d.wd]+'，'+h.textContent.replace(/今天$/,'')+(en.date===today?'（今天）':''));
    return a;
  }

  list.textContent='';
  let month=null,ol=null,count=0,shown=0;
  for(const en of entries){
    const key=en.date.slice(0,7);
    if(key!==month){
      if(ol)ol.previousSibling.querySelector('em').textContent=count+' 页';
      month=key;count=0;
      const [y,mo]=key.split('-').map(Number);
      const sec=el('section','tl-month'),mh=el('h2','tl-mh');
      mh.append(el('b',null,String(mo)),el('span',null,'月'),el('i',null,y+' · '+MOE[mo-1]),el('em'));
      ol=el('ol','tl-days');
      sec.append(mh,ol);list.appendChild(sec);
    }
    const d=parseDate(en.date),li=el('li');
    if(d.wd===0||d.wd===6)li.classList.add('we');
    if(en.date===today)li.classList.add('today');
    li.style.setProperty('--i',String(Math.min(shown++,8)));   // the first few come in one after another
    li.appendChild(card(en));
    ol.appendChild(li);count++;
  }
  if(ol)ol.previousSibling.querySelector('em').textContent=count+' 页';
  list.appendChild(el('p','tl-end',dot(entries[entries.length-1].date)+' · 从这里开始记'));
})();
