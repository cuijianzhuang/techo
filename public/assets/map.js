/* The map page (/map/): where the diary pages were written. A Mapbox map (the token from 手帐设置 → 地图), a
   pin for every place (coordinates are kept to two decimals, so a place is about a kilometre) with how many
   pages were written there; a pin opens a slip listing them, newest first, each opening the book at that
   page (/#e-<id>). Pages come from /api/entries with the keys this tab holds: a locked page never has its
   coordinates here unless the reader has opened it. */
(async function(){
  "use strict";
  const T=window.Techo,{el,parseDate}=T;
  const box=document.getElementById('map'),stat=document.getElementById('stat');
  const dot=s=>s.replace(/-/g,'.');
  function say(text,link,href){
    box.textContent='';
    const p=el('p','mp-msg',text);
    if(link){p.appendChild(document.createElement('br'));const a=el('a',null,link);a.href=href||'/';p.appendChild(a);}
    box.appendChild(p);
  }

  const held=T.keys();
  let entries,settings={};
  try{
    const [e,s]=await Promise.all([
      fetch('/api/entries',{headers:{accept:'application/json','x-techo-keys':Object.values(held).join(' ')}}).then(r=>{if(!r.ok)throw new Error('entries '+r.status);return r.json();}),
      fetch('/api/settings',{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    entries=(e.entries||[]).filter(en=>!en.locked&&parseDate(en.date)&&T.geoOf(en));
    settings=(s&&s.settings)||{};
  }catch(err){
    console.warn('techo map:',err);
    say('暂时摊不开地图，过一会儿再来。','回到手帐');
    return;
  }
  if(settings.siteTitle)document.title='足迹 · '+settings.siteTitle;
  T.nightTheme(settings);
  {const t=T.themeButton('theme-sw');if(t)document.body.appendChild(t);}   // ☾/☀ (the map redraws in the other style)
  if(!settings.mapboxToken){say('这本手帐还没有接上地图。','看看时间线','/timeline/');return;}
  if(!entries.length){say('还没有写下地点的日子。','去手帐看看');return;}

  // the places, each with its pages (newest first)
  entries=T.sortEntries(entries).reverse();
  const places=new Map();
  entries.forEach(en=>{
    const [la,lo]=T.geoOf(en),k=la.toFixed(2)+','+lo.toFixed(2);
    if(!places.has(k))places.set(k,{la,lo,name:'',pages:[]});
    const pl=places.get(k);pl.pages.push(en);if(!pl.name&&en.place)pl.name=en.place;
  });
  const all=[...places.values()];
  stat.textContent=all.length+' 个地方 · '+entries.length+' 页 · '+dot(entries[entries.length-1].date)+' → '+dot(entries[0].date);

  let gl;
  try{gl=await T.mapbox(settings.mapboxToken);}
  catch(err){say(err.message||'地图没加载上','回到手帐');return;}
  box.textContent='';
  const styleNow=()=>'mapbox://styles/mapbox/'+(document.documentElement.getAttribute('data-theme')==='dark'||(matchMedia('(prefers-color-scheme: dark)').matches&&document.documentElement.getAttribute('data-theme')!=='light')?'dark-v11':'light-v11');
  const map=new gl.Map({container:box,style:styleNow(),center:[all[0].lo,all[0].la],zoom:10,language:'zh-Hans',cooperativeGestures:matchMedia('(pointer: coarse)').matches});
  map.addControl(new gl.NavigationControl({showCompass:false}),'top-right');
  document.addEventListener('techo-theme',()=>map.setStyle(styleNow()));

  // a place's slip: where, then its pages
  function slip(pl){
    const w=el('div');
    if(pl.name)w.appendChild(el('p','mp-place',pl.name));
    const ul=el('ul','mp-list');
    pl.pages.forEach(en=>{
      const d=parseDate(en.date),li=el('li'),a=el('a');
      a.href='/#e-'+en.id;
      a.append(el('b',null,en.title||'（无题）'),el('span',null,dot(en.date)+' 星期'+'日一二三四五六'[d.wd]+(en.weather?' · '+en.weather:'')));
      li.appendChild(a);ul.appendChild(li);
    });
    w.appendChild(ul);
    return w;
  }
  const pinStyle='display:grid;place-items:center;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;'+
    'background:#d9573b;color:#fff;font:600 11px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer';
  all.forEach(pl=>{
    const pin=el('button','mp-pin',pl.pages.length>1?String(pl.pages.length):'');pin.type='button';pin.style.cssText=pinStyle;
    pin.setAttribute('aria-label',(pl.name||'一个地方')+'，'+pl.pages.length+' 页');
    new gl.Marker({element:pin}).setLngLat([pl.lo,pl.la]).setPopup(new gl.Popup({offset:14,maxWidth:'280px'}).setDOMContent(slip(pl))).addTo(map);
  });
  // everything in view (one place: close in on it)
  if(all.length>1){
    const b=new gl.LngLatBounds();all.forEach(pl=>b.extend([pl.lo,pl.la]));
    map.fitBounds(b,{padding:60,maxZoom:12,duration:0});
  }
})();
