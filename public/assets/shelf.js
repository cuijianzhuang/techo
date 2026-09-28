/* The shelf (/shelf/): every 书籍, 影视 and 音乐 card written in the diary. The same book (film, song) written
   of on several days is one thing on the shelf, as it was last written; it opens with all those days. Books
   stand on a wooden shelf, a year to a shelf (the year last written of), their spines their cover's colour
   and title (the one with a cover of its own faces out); films are posters on a wall; records sleeves with
   the record half out. #books / #films / #music says which. */
(async function(){
  "use strict";
  const T=window.Techo,K=window.Keep,{el,parseDate}=T;
  const box=document.getElementById('shelf'),stat=document.getElementById('stat'),tabs=document.getElementById('tabs');
  let entries;
  try{({entries}=await K.load('书架'));}
  catch(err){console.warn('techo shelf:',err);K.say(box,'暂时搬不动书架，过一会儿再来。<br><a href="/">回到手帐</a>');return;}

  // the things: one per title (and who by), as last written, with every day it was written on
  const KINDS=[['book','书','books'],['film','影','films'],['music','音','music']];
  const things={book:[],film:[],music:[]},seen=new Map();
  entries.forEach(en=>T.cardsOf(en.body).forEach(c=>{
    if(!things[c.kind])return;
    const f=T.ticketFields(c.lines);
    const name=(f.title||T.neteaseId(f.netease||f.link)||'').trim();if(!name)return;
    const key=c.kind+'|'+name.toLowerCase()+'|'+String(f.author||f.artist||f.director||'').trim().toLowerCase();
    let t=seen.get(key);
    if(!t){t={kind:c.kind,f,lines:c.lines,days:[],year:parseDate(en.date).y};seen.set(key,t);things[c.kind].push(t);}
    if(!t.days.includes(en))t.days.push(en);
  }));
  const thisYear=new Date().getFullYear(),n=k=>things[k].length,ny=k=>things[k].filter(t=>t.year===thisYear).length;
  stat.textContent=n('book')+n('film')+n('music')?
    [n('book')&&n('book')+' 本书',n('film')&&n('film')+' 部片',n('music')&&n('music')+' 首歌'].filter(Boolean).join(' · ')+
    ((ny('book')+ny('film')+ny('music'))?'　·　今年读了 '+ny('book')+' 本，看了 '+ny('film')+' 部，听了 '+ny('music')+' 首':''):'';

  const open=t=>K.show(t.kind,t.lines,t.days);
  const byYear=list=>{const m=new Map();list.forEach(t=>{if(!m.has(t.year))m.set(t.year,[]);m.get(t.year).push(t);});return [...m.entries()].sort((a,b)=>b[0]-a[0]);};
  const yearHead=(y,list,unit)=>{const h=el('h2','kp-year',String(y));h.appendChild(el('small',null,list.length+' '+unit));return h;};
  const stars=v=>{const s=String(v||'').trim(),m=/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/.exec(s);return m?m[1]:(s.match(/★/g)||[]).length||'';};
  // 进度: read to the end, or still reading
  const reading=f=>{const p=String(f.progress||'').trim();if(!p||/读完|完/.test(p))return false;const a=/^(\d+)\s*\/\s*(\d+)/.exec(p),c=/^(\d+(?:\.\d+)?)\s*%$/.exec(p);return a?+a[1]<+a[2]:c?+c[1]<100:false;};

  const DRAW={
    book(list){
      const out=el('div');
      byYear(list).forEach(([y,ts])=>{
        const shelf=el('div','sh-books');
        ts.forEach(t=>{
          const f=t.f,title=f.title||'书名',src=T.imgSrc(f.cover),slot=el('div','sh-slot');
          let b;
          if(src){b=el('button','sh-face');const i=el('img');i.src=src;i.alt='';i.loading='lazy';i.referrerPolicy='no-referrer';b.appendChild(i);}
          else{
            // each spine its own width and height, from its title: the same book always stands the same
            const h=T.hueOf(title),len=[...title].length;
            b=el('button','sh-spine'+(reading(f)?' sh-reading':''));
            b.style.setProperty('--h',h);b.style.setProperty('--w',(30+Math.min(14,len*1.5)+h%7)+'px');b.style.setProperty('--ht',(150+h%36)+'px');
            b.append(el('b',null,title),el('small',null,String(f.author||'').slice(0,4)));
          }
          b.type='button';b.title=title+(f.author?' · '+f.author:'')+(reading(f)?'（在读）':'');b.setAttribute('aria-label',b.title);
          b.onclick=()=>open(t);slot.appendChild(b);shelf.appendChild(slot);
        });
        out.append(yearHead(y,ts,'本'),shelf);
      });
      return out;
    },
    film(list){
      const out=el('div');
      byYear(list).forEach(([y,ts])=>{
        const wall=el('div','sh-wall');
        ts.forEach((t,i)=>{
          const f=t.f,title=f.title||'片名',src=T.imgSrc(f.cover);
          const b=el('button','sh-poster');b.type='button';
          const fr=el('div','sh-frame');fr.style.setProperty('--tilt',[-2.4,1.8,-1,2.6,-1.8][i%5]+'deg');fr.style.setProperty('--h',T.hueOf(title));
          if(src){const im=el('img');im.src=src;im.alt='';im.loading='lazy';im.referrerPolicy='no-referrer';fr.appendChild(im);}else fr.appendChild(el('span',null,title));
          const cap=el('div','sh-cap',title),sm=el('small');const r=stars(f.rating);
          if(r){sm.appendChild(el('b',null,'★ '+r));}
          if(f.year)sm.append((r?' · ':'')+f.year);
          if(sm.childNodes.length)cap.appendChild(sm);
          b.append(fr,cap);b.setAttribute('aria-label',title);b.onclick=()=>open(t);wall.appendChild(b);
        });
        out.append(yearHead(y,ts,'部'),wall);
      });
      return out;
    },
    music(list){
      const out=el('div');
      byYear(list).forEach(([y,ts])=>{
        const crate=el('div','sh-crate');
        ts.forEach(t=>{
          const f=t.f,ne=T.neteaseId(f.netease||f.link),src=T.imgSrc(f.cover);
          const b=el('button','sh-rec');b.type='button';
          const art=el('div','sh-art');art.style.setProperty('--h',T.hueOf((f.album||'')+(f.title||ne||'')));
          const sl=el('div','sh-sleeve');
          if(src){const im=el('img');im.src=src;im.alt='';im.loading='lazy';im.referrerPolicy='no-referrer';sl.appendChild(im);}else sl.appendChild(el('span',null,f.album||f.title||''));
          art.append(el('div','sh-disc'),sl);
          const cap=el('div','sh-cap',f.title||(ne?'网易云 · '+ne:'歌名'));
          const by=[f.artist,f.album&&'《'+f.album+'》'].filter(Boolean).join(' · ');if(by)cap.appendChild(el('small',null,by));
          // a 网易云 song written with its link alone: its name and cover from Meting, when they come
          if(ne&&(!f.title||!src))T.meting(ne).then(s=>{
            if(!f.title&&s.title)cap.firstChild.textContent=s.title;
            if(!by&&s.artist)cap.appendChild(el('small',null,s.artist));
            if(!src&&s.pic){sl.textContent='';const im=el('img');im.src=s.pic;im.alt='';im.referrerPolicy='no-referrer';sl.appendChild(im);}
          }).catch(()=>{});
          b.append(art,cap);b.setAttribute('aria-label',f.title||'网易云歌曲');b.onclick=()=>open(t);crate.appendChild(b);
        });
        out.append(yearHead(y,ts,'首'),crate);
      });
      return out;
    },
  };

  if(!n('book')&&!n('film')&&!n('music')){
    K.say(box,'书架还空着。<br>在日记里写 <code>```书籍</code>、<code>```影视</code> 或 <code>```音乐</code>，就会摆到这里。');return;
  }
  let at=(KINDS.find(k=>'#'+k[2]===location.hash)||KINDS.find(k=>n(k[0]))||KINDS[0])[0];
  function draw(){
    tabs.textContent='';
    KINDS.forEach(([k,label,hash])=>{
      const b=el('button',null,label+' '+n(k));b.type='button';b.setAttribute('aria-pressed',String(at===k));
      b.onclick=()=>{at=k;history.replaceState(null,'','#'+hash);draw();};tabs.appendChild(b);
    });
    box.textContent='';
    if(!n(at)){K.say(box,{book:'还没有写过书。',film:'还没有写过电影和剧。',music:'还没有写过歌。'}[at]);return;}
    box.appendChild(DRAW[at](things[at]));
  }
  draw();
})();
