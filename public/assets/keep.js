/* What the shelf (/shelf/) and the ticket folder (/tickets/) share: the diary's pages (from /api/entries, with
   the keys this tab holds: a locked page stays out unless the reader has opened it), the owner's settings
   (night paper, the site's name), and a card taken out to look at — drawn as on the page, with the days it
   was written on, each opening the book there (/#e-<id>). */
(function(){
  "use strict";
  const T=window.Techo,{el,parseDate}=T;
  const WD='日一二三四五六';
  async function load(label){
    const held=T.keys();
    const [e,s]=await Promise.all([
      fetch('/api/entries?view=cards',{headers:{accept:'application/json','x-techo-keys':Object.values(held).join(' ')}}).then(r=>{if(!r.ok)throw new Error('entries '+r.status);return r.json();}),
      fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    const settings=(s&&s.settings)||{};
    T.useSite(settings);                      // (the 网易云 player's Meting API)
    if(settings.siteTitle)document.title=label+' · '+settings.siteTitle;
    T.nightTheme(settings);
    T.applyBookFont(settings);
    {const t=T.themeButton('theme-sw');if(t)document.body.appendChild(t);}
    // 足迹, when the journal has a map
    if(settings.mapboxToken){const tl=document.querySelector('.kp-back[href="/timeline/"]');if(tl){const m=el('a','kp-back','足迹');m.href='/map/';tl.after(m);}}
    const entries=T.sortEntries((e.entries||[]).filter(en=>!en.locked&&en.body&&parseDate(en.date))).reverse();   // newest first
    return {entries,settings};
  }
  /* what a 账单 came to and what it went on (the bills page, and the year in review): its "* 分组: ¥" lines, or its
     lines with an amount when it has no groups, or else its title; its "= 合计" line, or what those add up to */
  // an amount: "¥1,280.50", "65", "¥45.00 元" (not a date or a count: "2026年9月28日")
  const AMOUNT=/^[¥￥$€]?\s*-?[\d,，]+(?:\.\d+)?\s*元?$/;
  const num=v=>{const s=String(v||'').trim();if(!AMOUNT.test(s))return null;const n=/-?[\d,，]+(?:\.\d+)?/.exec(s);return n?+n[0].replace(/[,，]/g,''):null;};
  function bill(lines){
    let title='',total=null;const groups=[],items=[];
    lines.forEach(raw=>{
      const l=raw.trim();let m;
      if((m=/^#\s+(.+)$/.exec(l))){title=m[1].trim();return;}
      if((m=/^=\s*(.+)$/.exec(l))){const kv=T.kvOf(m[1]);total=num(kv?kv[1]:m[1]);return;}
      if((m=/^\*\s+(.+)$/.exec(l))){const kv=T.kvOf(m[1]),v=kv&&num(kv[1]);if(v!=null)groups.push([kv[0].trim(),v]);return;}
      const kv=T.kvOf((/^-\s+(.+)$/.exec(l)||[])[1]||l),v=kv&&num(kv[1]);
      if(v!=null)items.push([kv[0].trim(),v]);
    });
    let cats=groups.length?groups:items;
    const added=cats.reduce((a,c)=>a+c[1],0);
    if(total==null)total=added;
    if(!cats.length)cats=[[title||'其他',total]];
    else if(total-added>0.005)cats=cats.concat([['其他',total-added]]);
    return {total,cats};
  }
  const dayOf=en=>{const d=parseDate(en.date);return d.y+'.'+String(d.mo).padStart(2,'0')+'.'+String(d.d).padStart(2,'0')+' 周'+WD[d.wd];};
  // the card, big, over the desk: Esc, the ✕ or a click beside it puts it back
  function show(kind,lines,days){
    const pop=el('div','kp-pop'),sheet=el('div','kp-sheet');
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','卡片');
    const x=el('button','kp-x','×');x.type='button';x.setAttribute('aria-label','关上');
    const jp=el('div','jp'),tx=el('div','jtext');tx.appendChild(T.cardNode(kind,lines));jp.appendChild(tx);
    const where=el('div','kp-where');
    where.appendChild(el('div',null,days.length>1?'写在这 '+days.length+' 天：':'写在这一天：'));
    days.forEach(en=>{const a=el('a');a.href='/#e-'+en.id;a.append(el('b',null,en.title||'（无题）'),el('span',null,dayOf(en)),el('i',null,'翻到那一页 →'));where.appendChild(a);});
    sheet.append(x,jp,where);pop.appendChild(sheet);
    const back=document.activeElement;
    const close=()=>{pop.remove();document.removeEventListener('keydown',key);if(back&&back.focus)back.focus();};
    const key=e=>{if(e.key==='Escape')close();};
    x.onclick=close;pop.addEventListener('click',e=>{if(e.target===pop)close();});
    document.addEventListener('keydown',key);
    document.body.appendChild(pop);x.focus();
  }
  function say(box,text){box.textContent='';const p=el('p','kp-msg');p.innerHTML=text;box.appendChild(p);}   // (fixed words only)
  window.Keep={load,show,say,dayOf,bill};
})();
