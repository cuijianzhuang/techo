/* Admin for the journal: write pages, upload photos to R2, edit contact info. */
(function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const main=$('main'),list=$('list');
  let entries=[],settings={},jots=[],bookLocked=false,newLock=null,aiKeySet=false;
  const dayLocks=new Set();      // dates locked as a whole day (from 随手记)
  let sel=null;            // entry id | 'new' | 'settings' | 'jots' | null
  let draft=null;          // working copy of the selected thing
  let base='';             // JSON of draft when loaded, to detect changes
  let busy=false;

  $('today').textContent='今天是 '+T.todayStr();

  /* ---------- API ---------- */
  async function api(path,opt){
    const r=await fetch(path,Object.assign({credentials:'same-origin',headers:{accept:'application/json'}},opt||{}));
    let body=null;try{body=await r.json();}catch(e){}
    if(r.status===401){gate();throw new Error('需要登录');}
    if(!r.ok)throw new Error((body&&body.error)||('请求失败（'+r.status+'）'));
    return body;
  }
  const LOGIN_MSG={denied:'这个 GitHub 账号没有权限。',cancelled:'登录取消了。',expired:'登录超时了，再点一次。',failed:'GitHub 登录没成功，稍后再试。'};
  // read ?login=… (set by the GitHub callback) once, then drop it so a reload doesn't repeat the message
  const loginWhy=new URLSearchParams(location.search).get('login');
  if(location.search)history.replaceState(null,'',location.pathname);
  function gate(){
    $('gate').hidden=false;$('logout').hidden=true;
    if(loginWhy&&LOGIN_MSG[loginWhy])$('gateMsg').textContent=LOGIN_MSG[loginWhy];
    $('gateDate').textContent=T.todayStr().replace(/-/g,'.');
    document.body.classList.add('gated');
    // the journal's own name, as on its cover (settings are public)
    fetch('/api/settings').then(r=>r.ok?r.json():null).then(d=>{
      const t=d&&d.settings&&d.settings.coverTitle;if(!t)return;
      const n=$('gateName'),i=t.indexOf('.');n.textContent='';
      if(i<0)n.textContent=t;else n.append(t.slice(0,i),el('b',null,'.'),t.slice(i+1));
    }).catch(()=>{});
  }
  $('logout').onclick=async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch(e){}location.reload();};
  const sendJson=(method,path,obj)=>api(path,{method,headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(obj)});

  /* ---------- list: search, filter by status, grouped by month ---------- */
  let listQuery='',listFilter='all';
  const FILTERS=[['all','全部'],['draft','草稿'],['published','已发布']];
  const plain=en=>[en.title,en.latin,en.aside,en.body,en.note,en.place,en.weather,en.quote,en.date,en.date.replace(/-0?/g,'/')].join('\n').toLowerCase();
  function drawList(){
    list.textContent='';
    const nd=entries.filter(e=>e.status==='draft').length;
    $('countLabel').textContent='已写的页 · '+entries.length;
    const fl=$('lfilter');fl.textContent='';
    FILTERS.forEach(([k,label])=>{
      const n=k==='all'?entries.length:k==='draft'?nd:entries.length-nd;
      const b=el('button',null,label+' '+n);b.type='button';b.setAttribute('aria-pressed',listFilter===k?'true':'false');
      b.onclick=()=>{listFilter=k;drawList();};
      fl.appendChild(b);
    });
    const q=listQuery.trim().toLowerCase();
    const shown=T.sortEntries(entries).reverse().filter(en=>
      (listFilter==='all'||(listFilter==='draft')===(en.status==='draft'))&&(!q||plain(en).includes(q)));
    if(!shown.length){
      list.appendChild(el('div','lempty',entries.length?'没有找到。':'还没有写过。点上面「新写一页」开始。'));
    }
    let month='';
    shown.forEach(en=>{
      const d=T.parseDate(en.date),m=d?d.y+' 年 '+d.mo+' 月':'';
      if(m!==month){month=m;list.appendChild(el('div','lmonth',m));}
      const it=el('button','item'+(en.status==='draft'?' draft':''));it.type='button';it.dataset.id=en.id;
      it.setAttribute('aria-current',sel===en.id?'true':'false');
      const t=el('b',null,en.title||'（无题）');
      if(en.status==='draft')t.appendChild(el('em','tag','草稿'));
      const meta=el('span',null,(d?d.mo+'/'+d.d:en.date)+((en.photos&&en.photos.length)||en.photoKey?' · 有照片':'')+(en.locked?' · 🔒 单独上锁':dayLocks.has(en.date)?' · 🔒 这一天上锁':''));
      const gist=T.plainText(en.body);
      it.append(t,meta);
      if(gist)it.appendChild(el('i','gist',gist.length>30?gist.slice(0,30)+'…':gist));
      (en.stickers||[]).slice(0,2).forEach(k=>{const g=T.stickerSvg(k,18);if(g){g.classList.add('lstk');it.appendChild(g);}});
      it.onclick=()=>select(en.id);
      list.appendChild(it);
    });
    $('newBtn').setAttribute('aria-current',sel==='new'?'true':'false');
    $('settingsBtn').setAttribute('aria-current',sel==='settings'?'true':'false');
    $('jotsBtn').setAttribute('aria-current',sel==='jots'?'true':'false');
  }
  $('q').addEventListener('input',e=>{listQuery=e.target.value;drawList();});
  $('newBtn').onclick=()=>select('new');
  $('jotsBtn').onclick=()=>select('jots');
  $('settingsBtn').onclick=()=>select('settings');

  const dirty=()=>draft&&JSON.stringify(stripLocal(draft))!==base;
  function stripLocal(d){
    const c=Object.assign({},d);delete c.photoUrl;
    // photos being uploaded carry a local preview url: not part of the page
    if(Array.isArray(c.photos))c.photos=c.photos.map(p=>({key:p.key,cap:p.cap||''}));
    return c;
  }

  /* switching away from unsaved changes asks first, inline */
  function select(id,force){
    if(busy)return;
    if(!force&&dirty()&&id!==sel){
      const box=main.querySelector('.unsaved');if(box)box.remove();
      const u=el('div','unsaved');u.append('这一页有改动还没保存。');
      const sv=el('button','b small pri','保存');sv.type='button';sv.onclick=async()=>{if(await save())select(id,true);};
      const ds=el('button','b small','放弃改动');ds.type='button';ds.onclick=()=>select(id,true);
      const st=el('button','b small','继续编辑');st.type='button';st.onclick=()=>u.remove();
      u.append(sv,ds,st);
      const f=main.querySelector('.form');(f||main).prepend(u);
      return;
    }
    sel=id;
    if(id==='settings'){draft=Object.assign({},settings);}
    else if(id==='jots'){draft=null;}
    else if(id==='new'){newLock=null;draft={date:T.todayStr(),title:'',latin:'',stamp:'',aside:'',body:'',note:'',mood:'mug',quote:'',quoteSrc:'',photoKey:'',photoCap:'',photos:[],place:'',geo:'',weather:'',stickers:[],status:'published'};}
    else{const en=entries.find(e=>e.id===id);draft=en?Object.assign({},en,{photos:(en.photos||[]).map(p=>Object.assign({},p))}):null;}
    base=draft?JSON.stringify(stripLocal(draft)):'';
    drawList();drawForm();
  }

  /* ---------- form ---------- */
  let pvbox=null,statusEl=null;
  function status(msg,kind){if(statusEl){statusEl.textContent=msg||'';statusEl.className='status'+(kind?' '+kind:'');}}
  function field(label,key,type,opts){
    opts=opts||{};
    const l=el('label');l.append(label);
    let inp;
    if(type==='textarea'){inp=el('textarea');inp.rows=opts.rows||9;}
    else if(type==='select'){inp=el('select');opts.options.forEach(([v,t])=>{const o=el('option',null,t);o.value=v;inp.appendChild(o);});}
    else{inp=el('input');inp.type=type||'text';}
    inp.id='f-'+key;inp.value=draft[key]||'';
    if(opts.max)inp.maxLength=opts.max;
    if(opts.ph)inp.placeholder=opts.ph;
    const on=()=>{draft[key]=inp.value;changed();};
    inp.addEventListener('input',on);inp.addEventListener('change',on);
    l.appendChild(inp);
    if(opts.hint)l.appendChild(el('span','hintx',opts.hint));
    return l;
  }
  function changed(){
    drawPreview();
    status(dirty()?'有改动还没保存。':'');
  }
  function drawPreview(){
    if(!pvbox||!draft||sel==='settings')return;
    pvbox.textContent='';
    const p=T.fitText(T.entryPage(draft,'r'));
    pvbox.appendChild(p);
  }
  function drawForm(){
    main.textContent='';pvbox=null;statusEl=el('div','status');
    if(sel==='jots'){drawJots();return;}
    if(!sel||!draft){
      const d=el('div','form');
      d.append(el('h2',null,'今天写点什么？'),el('div','hand','点左边「新写一页」开始写，或者选一页已经写过的来改。保存后主页马上就能看到。'));
      main.appendChild(d);return;
    }
    const f=el('form','form');f.noValidate=true;
    f.addEventListener('submit',e=>{e.preventDefault();save();});
    if(sel==='settings'){
      const sect=(t,hint)=>{const h=el('h3','fsect',t);return hint?[h,el('div','hintx',hint)]:[h];};
      f.append(el('h2',null,'手帐设置'),
        ...sect('网站','浏览器标签上的标题，和搜索、分享链接里显示的一句介绍。'),
        field('网站标题','siteTitle','text',{max:40}),
        field('一句介绍','siteDesc','text',{max:120}),
        ...sect('封面'),
        field('封面大字','coverTitle','text',{max:16,hint:'第一个「.」会变成绿色的小圆点，比如 cui.log'}),
        field('大字下面的一行','coverSub','text',{max:40}),
        coverStickerField(),
        coverPhotoField(),
        ...sect('扉页','翻开封面后第一页的 README。'),
        field('whoami（名字）','readmeName','text',{max:30}),
        field('cat role（在做什么）','readmeRole','text',{max:40}),
        field('ls ~/life（生活里有什么）','readmeLife','text',{max:60}),
        field('从哪天开始记','readmeSince','text',{max:20,ph:'2026-09'}),
        field('小咖旁边那句话','readmeSign','text',{max:30}),
        ...sect('封底'),
        field('封底大字','backTitle','text',{max:12}),
        field('封底下方小字','backImprint','textarea',{rows:2,max:80,hint:'可以换行'}),
        ...sect('加密','给整本手帐设一个口令。'),
        lockField('book'),
        ...sect('翻页方式','首页的书怎么翻。'),
        bookModeField(),
        ...sect('示例页'),
        samplesField(),
        ...sect('AI','写草稿用的模型：「随手记」里的「现在就写一页」和每晚的自动草稿。只给后台看，不会出现在主页上。'),
        aiField(),
        ...sect('联系方式','显示在「写信给我」那一页。'),
        field('邮箱','email','email',{ph:'you@example.com',max:120}),
        field('GitHub 地址','github','url',{ph:'https://github.com/你的用户名',hint:'要以 https:// 开头',max:200}),
        field('链接上显示的文字（可空）','githubText','text',{ph:'github.com/你的用户名',max:60}));
      const b=el('div','bar');const s=el('button','b pri','保存设置');s.type='submit';b.appendChild(s);
      f.append(b,statusEl);main.appendChild(f);return;
    }
    f.appendChild(el('h2',null,sel==='new'?'新的一页':draft.status==='draft'?'草稿':'编辑这一页'));
    if(draft.status==='draft')f.appendChild(el('div','hintx','这一页还是草稿，主页上看不到。看过没问题就点「发布这一页」。'));
    const r1=el('div','row');r1.append(dateField(),field('页眉小字','aside','text',{ph:'比如：下了一整天雨',max:30}));
    const r2=el('div','row');r2.append(field('标题（手写大字）','title','text',{ph:'今天的标题',max:30,hint:'8 个字以内最好看'}),field('英文小注','latin','text',{ph:'a small note in English',max:60}));
    f.append(r1,r2,suggestField(),placeField(),mdField());
    f.appendChild(photoField());
    f.appendChild(stickerField());
    const r3=el('div','row');r3.append(field('贴一张便签（可空）','note','text',{ph:'一句话，像纸条一样贴在正文下面',max:60}),
      field('小咖','mood','select',{options:[['mug','醒着'],['sleep','睡着'],['none','不出场']]}));
    const r4=el('div','row');r4.append(field('印章（一个字）','stamp','text',{ph:'记',max:2}),field('页脚引文','quote','text',{ph:'一句喜欢的话',max:120}));
    f.append(r3,r4,field('引文出处','quoteSrc','text',{ph:'作者《书名》',max:60}));
    {const h=el('h3','fsect','单独上锁');h.style.fontSize='18px';f.appendChild(h);}
    if(sel!=='new'){
      if(dayLocks.has(draft.date)){
        // locked as a whole day from 随手记: say so, and let it be taken off here too
        const n=el('div','lockf');n.appendChild(el('div','hintx','🔒 这一天在随手记里上了锁：这一天的页都要用那个口令打开（这一页若再单独上锁，就用它自己的口令）。'));
        const bar=el('div','bar'),off=el('button','b small warn','取消这一天的锁');off.type='button';
        off.onclick=async()=>{if(busy)return;busy=true;try{await sendJson('PUT','/api/admin/locks/'+encodeURIComponent('d-'+draft.date),{password:null});dayLocks.delete(draft.date);drawList();drawForm();status('这一天不上锁了。','ok');}catch(e){status(e.message||'没有保存成功','err');}finally{busy=false;}};
        bar.appendChild(off);n.appendChild(bar);f.appendChild(n);
      }
      f.appendChild(lockField(sel));
    }else f.appendChild(newLockField());
    const b=el('div','bar');
    const isDraft=draft.status==='draft';
    const s=el('button','b pri',isDraft?'发布这一页':sel==='new'?'保存这一页':'保存修改');s.type='button';
    s.onclick=()=>{draft.status='published';save();};
    const s2=el('button','b',isDraft||sel==='new'?'存为草稿':'改回草稿');s2.type='button';
    s2.onclick=()=>{draft.status='draft';save();};
    b.append(s,s2);
    if(sel!=='new'){
      const del=el('button','b warn','删除这一页');del.type='button';
      del.onclick=()=>{
        const c=el('span','confirm','删除后不能恢复，确定？');
        const yes=el('button','b warn small','删除');yes.type='button';
        const no=el('button','b small','取消');no.type='button';
        c.append(yes,no);del.replaceWith(c);
        no.onclick=()=>c.replaceWith(del);
        yes.onclick=remove;
      };
      b.appendChild(del);
    }
    f.append(b,statusEl);
    const pv=el('div','pv');pvbox=el('div','pvbox');
    pv.append(pvbox,el('div','pvcap','预览 · 保存后会按日期排进手帐'));
    main.append(f,pv);drawPreview();
    if(sel==='new')setTimeout(()=>{const t=$('f-title');if(t)t.focus();},0);
  }

  /* ---------- date: a paper calendar instead of the browser's picker ---------- */
  const WD='日一二三四五六',MOE=['Jan.','Feb.','Mar.','Apr.','May','Jun.','Jul.','Aug.','Sept.','Oct.','Nov.','Dec.'];
  const iso=d=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
  const utc=s=>{const d=T.parseDate(s);return d?new Date(Date.UTC(d.y,d.mo-1,d.d)):null;};
  function dateField(){
    const wrap=el('div','datef');
    const lab=el('label');lab.append('日期');
    const btn=el('button','dbtn');btn.type='button';btn.id='f-date';
    btn.setAttribute('aria-haspopup','dialog');btn.setAttribute('aria-expanded','false');
    lab.appendChild(btn);wrap.appendChild(lab);
    const show=()=>{
      const d=T.parseDate(draft.date);btn.textContent='';
      if(!d){btn.appendChild(el('b',null,'选一天'));}
      else btn.append(el('b',null,draft.date.replace(/-/g,'.')),el('span','dwd'+(d.wd===0||d.wd===6?' we':''),'周'+WD[d.wd]));
      btn.appendChild(el('i','dico'));
    };
    show();
    let pop=null,focus=null;   // focus: the UTC date the keyboard is on
    const outside=e=>{if(!wrap.contains(e.target))close();};
    function close(back){
      if(!pop)return;pop.remove();pop=null;btn.setAttribute('aria-expanded','false');
      document.removeEventListener('pointerdown',outside,true);
      if(back)btn.focus();
    }
    function pick(d){draft.date=iso(d);show();changed();close(true);}
    function render(){
      pop.textContent='';
      const y=focus.getUTCFullYear(),mo=focus.getUTCMonth();
      const head=el('div','dhead');
      const t=el('div','dtitle');t.append(el('b',null,String(mo+1)),el('span',null,'月'),el('i',null,MOE[mo]+' '+y));
      t.id='dtitle';
      const nav=(txt,label,dm)=>{const b=el('button','dnav',txt);b.type='button';b.setAttribute('aria-label',label);b.onclick=()=>{focus=new Date(Date.UTC(y,mo+dm,1));render();};return b;};
      head.append(nav('‹','上个月',-1),t,nav('›','下个月',1));
      const grid=el('div','dgrid');grid.setAttribute('role','grid');grid.setAttribute('aria-labelledby','dtitle');
      '一二三四五六日'.split('').forEach((c,i)=>grid.appendChild(el('span','h'+(i>4?' we':''),c)));
      const first=new Date(Date.UTC(y,mo,1)),start=new Date(first-((first.getUTCDay()+6)%7)*864e5);
      const sel=draft.date,today=T.todayStr(),fk=iso(focus);
      for(let i=0;i<42;i++){
        const d=new Date(+start+i*864e5),k=iso(d),wd=d.getUTCDay();
        const b=el('button','dday'+(d.getUTCMonth()!==mo?' out':'')+(wd===0||wd===6?' we':'')+(k===today?' today':''),String(d.getUTCDate()));
        b.type='button';b.tabIndex=k===fk?0:-1;b.dataset.k=k;
        b.setAttribute('aria-label',d.getUTCFullYear()+'年'+(d.getUTCMonth()+1)+'月'+d.getUTCDate()+'日 周'+WD[wd]+(k===today?'（今天）':''));
        b.setAttribute('aria-pressed',k===sel?'true':'false');
        b.onclick=()=>pick(d);
        grid.appendChild(b);
      }
      grid.addEventListener('keydown',e=>{
        const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
        if(step){e.preventDefault();focus=new Date(+focus+step*864e5);}
        else if(e.key==='PageUp'||e.key==='PageDown'){e.preventDefault();focus=new Date(Date.UTC(focus.getUTCFullYear(),focus.getUTCMonth()+(e.key==='PageUp'?-1:1),Math.min(focus.getUTCDate(),28)));}
        else if(e.key==='Home'||e.key==='End'){e.preventDefault();focus=new Date(+focus+((e.key==='Home'?0:6)-(focus.getUTCDay()+6)%7)*864e5);}
        else return;
        if(focus.getUTCMonth()!==mo||focus.getUTCFullYear()!==y)render();
        else grid.querySelectorAll('.dday').forEach(b=>b.tabIndex=b.dataset.k===iso(focus)?0:-1);
        const f=pop.querySelector('.dday[tabindex="0"]');if(f)f.focus();
      });
      const foot=el('div','dfoot');
      const tb=el('button','dlink','回到今天');tb.type='button';tb.onclick=()=>pick(utc(today));
      const cb=el('button','dlink quiet','关闭');cb.type='button';cb.onclick=()=>close(true);
      foot.append(tb,cb);
      pop.append(head,grid,foot);
    }
    function open(){
      focus=utc(draft.date)||utc(T.todayStr());
      pop=el('div','dpop');pop.setAttribute('role','dialog');pop.setAttribute('aria-label','选择日期');
      pop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}});
      wrap.appendChild(pop);render();btn.setAttribute('aria-expanded','true');
      document.addEventListener('pointerdown',outside,true);
      const f=pop.querySelector('.dday[tabindex="0"]');if(f)f.focus();
    }
    btn.onclick=()=>pop?close():open();
    return wrap;
  }

  /* ---------- 手帐设置: cover stickers, cover pictures, sample pages ---------- */
  const COVER_STICKERS=[['mug','小咖'],['nas','NAS'],['cloud','云'],['film','胶卷'],['ticket','机票']];
  const csv=v=>String(v||'').split(',').filter(Boolean);
  function coverStickerField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';l.textContent='封面上原来的贴纸（点一下隐藏 / 显示）';
    const row=el('div','chips');row.setAttribute('role','group');row.setAttribute('aria-label','封面上原来的贴纸');
    COVER_STICKERS.forEach(([k,label])=>{
      const b=el('button','chip',label);b.type='button';
      const paint=()=>b.setAttribute('aria-pressed',csv(draft.coverHide).includes(k)?'false':'true');
      b.onclick=()=>{const h=csv(draft.coverHide);draft.coverHide=(h.includes(k)?h.filter(x=>x!==k):h.concat(k)).join(',');paint();changed();};
      paint();row.appendChild(b);
    });
    wrap.append(l,row);return wrap;
  }
  function coverPhotoField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='我的贴纸（最多 4 张，会带白边贴在封面上；透明背景的 PNG 效果最好）';
    const row=el('div','cphotos');
    const paint=()=>{
      row.textContent='';
      const keys=csv(draft.coverPhotos);
      keys.forEach(k=>{
        const t=el('div','cphoto');t.style.backgroundImage='url("/img/'+k+'")';
        const x=el('button','cx','×');x.type='button';x.setAttribute('aria-label','拿掉这张');
        x.onclick=()=>{draft.coverPhotos=csv(draft.coverPhotos).filter(y=>y!==k).join(',');paint();changed();};
        t.appendChild(x);row.appendChild(t);
      });
      if(keys.length<4){
        const fb=el('span','b small filebtn','添加图片');
        const inp=el('input');inp.type='file';inp.accept='image/png,image/webp,image/jpeg,image/gif';inp.setAttribute('aria-label','添加封面贴纸');
        fb.appendChild(inp);row.appendChild(fb);
        inp.addEventListener('change',async()=>{
          const file=inp.files&&inp.files[0];if(!file)return;
          fb.firstChild.textContent='上传中……';status('正在上传……');
          try{
            const blob=await shrink(file,600,true);
            const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
            draft.coverPhotos=csv(draft.coverPhotos).concat(r.key).join(',');paint();changed();
            status('图片已上传，记得保存设置。','ok');
          }catch(e){fb.firstChild.textContent='添加图片';status(e.message||'上传失败','err');}
        });
      }
    };
    paint();wrap.append(l,row);return wrap;
  }
  /* a password for the whole book ('book') or this one day (its id). Saved at once, apart from the form:
     only a hash is kept, so a forgotten password is simply set again here */
  function lockField(scope){
    const book=scope==='book',day=/^d-/.test(scope)?scope.slice(2):null,en=book||day?null:entries.find(e=>e.id===scope);
    const on=book?bookLocked:day?dayLocks.has(day):!!(en&&en.locked);
    const w=el('div','lockf');
    w.appendChild(el('div','hintx',on
      ?(book?'🔒 整本已上锁：主页上的日记只露出日期，读者输入口令才能看（单独上锁的那几天仍要用各自的口令）。'
        :day?'🔒 今天写成的那一页会上锁：不管是你点「现在就写一页」，还是每晚自动写的，都要用这个口令打开。'
            :'🔒 这一页已单独上锁：只露出日期，要用这里的口令打开，整本的口令打不开它。')
      :(book?'上锁后，主页上所有日记只露出日期，读者在封面输入口令才能看；示例页也会收起来。'
        :day?'今天用随手记写成的那一页要不要上锁？设了口令，写好发布后读者只看得到日期。'
            :'单独上锁后，这一页只露出日期，要用这里设的口令打开（和整本的口令分开）。')));
    const row=el('div','row');
    const mk=(ph,id)=>{const i=el('input');i.type='password';i.autocomplete='new-password';i.placeholder=ph;i.id=id;i.maxLength=128;return i;};
    const p1=mk(on?'新口令（至少 4 个字符）':'口令（至少 4 个字符）','lk1-'+scope),p2=mk('再输一遍','lk2-'+scope);
    const l1=el('label','fld');l1.append(el('span',null,on?'改成新口令':'口令'),p1);
    const l2=el('label','fld');l2.append(el('span',null,'确认'),p2);
    row.append(l1,l2);w.appendChild(row);
    const bar=el('div','bar');
    const go=el('button','b small',on?'改口令':(book?'给整本上锁':day?'今天这一页上锁':'给这一页上锁'));go.type='button';
    const send=async(password,done)=>{
      if(busy)return;busy=true;status('正在保存……');
      try{
        await sendJson('PUT','/api/admin/locks/'+encodeURIComponent(scope),{password});
        const now=password!==null;
        if(book)bookLocked=now;else if(day){if(now)dayLocks.add(day);else dayLocks.delete(day);}else if(en)en.locked=now;
        drawList();if(sel==='jots')drawJots(true);else drawForm();status(done,'ok');
      }catch(e){status(e.message||'没有保存成功','err');}
      finally{busy=false;}
    };
    go.onclick=()=>{
      if([...p1.value].length<4){status('口令至少 4 个字符。','err');p1.focus();return;}
      if(p1.value!==p2.value){status('两次输入的口令不一样。','err');p2.focus();return;}
      send(p1.value,on?'口令已改好；读者需要用新口令重新打开。':'已上锁。');
    };
    bar.appendChild(go);
    if(on){
      const off=el('button','b small warn','取消上锁');off.type='button';
      off.onclick=()=>send(null,book?'整本已取消上锁。':day?'今天这一页不上锁了。':'这一页已取消上锁。');
      bar.appendChild(off);
    }
    w.appendChild(bar);
    return w;
  }
  /* a new page can be locked as it's saved: the password waits here until the page exists */
  function newLockField(){
    const w=el('div','lockf');
    w.appendChild(el('div','hintx','想让这一页只给知道口令的人看，就在这里设口令；不填就不上锁。保存时一起生效。'));
    const row=el('div','row');
    const mk=(ph,id)=>{const i=el('input');i.type='password';i.autocomplete='new-password';i.placeholder=ph;i.id=id;i.maxLength=128;return i;};
    const p1=mk('口令（至少 4 个字符，可不填）','nl1'),p2=mk('再输一遍','nl2');
    if(newLock){p1.value=newLock.p1;p2.value=newLock.p2;}
    const upd=()=>{newLock=p1.value||p2.value?{p1:p1.value,p2:p2.value}:null;};
    p1.oninput=p2.oninput=upd;
    const l1=el('label','fld');l1.append(el('span',null,'口令'),p1);
    const l2=el('label','fld');l2.append(el('span',null,'确认'),p2);
    row.append(l1,l2);w.appendChild(row);
    return w;
  }
  function bookModeField(){
    const w=el('div');
    [['auto','自动','手机用平面翻页（翻动时和静止时一模一样，也更省内存），平板和电脑用立体的书（默认）'],['3d','立体的书','有厚度和光影，纸从页角卷起翻过去；手机上也用它'],['flip','平面翻页','轻一些的翻页效果；不支持立体效果的设备也会用它']].forEach(([v,name,hint])=>{
      const l=el('label','check1');
      const r=el('input');r.type='radio';r.name='f-bookmode';r.value=v;r.checked=(draft.bookMode||'auto')===v;
      r.onchange=()=>{if(r.checked){draft.bookMode=v;changed();}};
      l.append(r,el('span',null,name));w.append(l,el('div','hintx',hint));
    });
    return w;
  }
  /* 手帐设置 → AI: the format the endpoint speaks, the endpoint (empty: Anthropic's own / OpenAI's own), a model,
     whether the Worker has its key, and 测试连接 (with what's typed, before saving) */
  const AI_FORMATS={
    anthropic:{ph:'https://api.anthropic.com',hint:'留空就是 Claude 官方接口。中转或其他厂商的 Anthropic 兼容地址填到 /v1 之前，比如 https://api.deepseek.com/anthropic',model:'claude-opus-5'},
    openai:{ph:'https://api.openai.com/v1',hint:'填到 /v1（不用加 /chat/completions），比如 https://api.deepseek.com、https://dashscope.aliyuncs.com/compatible-mode/v1；留空是 OpenAI 官方',model:'gpt-5 / deepseek-chat / qwen-plus …'},
  };
  function aiField(){
    const w=el('div');w.style.cssText='display:grid;gap:10px';
    const fmt=AI_FORMATS[draft.aiFormat==='openai'?'openai':'anthropic'];
    const pick=field('接口格式','aiFormat','select',{options:[['anthropic','Anthropic（Claude 官方、中转、各家 /anthropic 地址）'],['openai','OpenAI（/chat/completions：OpenAI、DeepSeek、通义、Kimi、中转…）']]});
    pick.querySelector('select').addEventListener('change',()=>drawForm());   // the hints follow the format
    const row=el('div','row');
    row.append(field('接口地址（可空）','aiBaseUrl','url',{ph:fmt.ph,max:200,hint:fmt.hint}),
      field('模型','aiModel','text',{ph:fmt.model,max:80,hint:draft.aiFormat==='openai'?'填那边的模型名':'留空是 claude-opus-5'}));
    const key=el('div','hintx',aiKeySet?'✓ 已配置 key（Worker 密钥 AI_API_KEY 或 ANTHROPIC_API_KEY）':'✗ 还没有 key：运行 npx wrangler secret put AI_API_KEY，填这个接口的 key');
    key.style.color=aiKeySet?'var(--olive)':'var(--red)';
    const acts=el('div','photo-actions'),t=el('button','b small','测试连接'),out=el('span','hintx');
    t.type='button';acts.append(t,out);
    t.onclick=async()=>{
      t.disabled=true;out.textContent='正在问……';out.style.color='';
      try{
        const r=await sendJson('POST','/api/admin/ai/test',{aiFormat:draft.aiFormat||'anthropic',aiBaseUrl:draft.aiBaseUrl||'',aiModel:draft.aiModel||''});
        out.textContent='✓ 连上了：'+r.model+' 回复「'+(r.reply||'（空）')+'」';out.style.color='var(--olive)';
      }catch(e){out.textContent='✗ '+(e.message||'没连上');out.style.color='var(--red)';}
      finally{t.disabled=false;}
    };
    w.append(pick,row,key,acts);
    return w;
  }
  function samplesField(){
    const l=el('label','check1');
    const cb=el('input');cb.type='checkbox';cb.id='f-samples';cb.checked=draft.samples!=='hide';
    cb.onchange=()=>{draft.samples=cb.checked?'show':'hide';changed();};
    l.append(cb,el('span',null,'显示开头的示例页（9/25–9/29）'));
    const w=el('div');w.append(l,el('div','hintx','隐藏后，「写信给我」那一页会移到最后一篇日记后面，联系方式还在。'));
    return w;
  }

  /* ---------- doodles ---------- */
  function stickerField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='小插画（最多两个，翻到这页时会一笔一笔画出来）';
    const grid=el('div','stkpick');grid.setAttribute('role','group');grid.setAttribute('aria-label','小插画');
    const cur=()=>Array.isArray(draft.stickers)?draft.stickers:[];
    const paint=()=>grid.querySelectorAll('button').forEach(bt=>bt.setAttribute('aria-pressed',cur().includes(bt.dataset.k)?'true':'false'));
    T.stickerList.forEach(({key,label})=>{
      const bt=el('button');bt.type='button';bt.dataset.k=key;bt.title=label;
      bt.append(T.stickerSvg(key,34),el('span',null,label));
      bt.onclick=()=>{
        let a=cur().slice();
        if(a.includes(key))a=a.filter(k=>k!==key);
        else{a.push(key);if(a.length>2)a.shift();}
        draft.stickers=a;paint();changed();
      };
      grid.appendChild(bt);
    });
    paint();wrap.append(l,grid);return wrap;
  }

  /* ---------- jots: loose lines for tonight's page ---------- */
  let jotsToday=null;
  function drawJots(again){
    if(again){main.textContent='';statusEl=el('div','status');}
    const f=el('form','form');f.noValidate=true;
    f.append(el('h2',null,'随手记'),el('div','hintx','白天想到什么就记一句。每晚 22:00 Claude 会把今天记下的这些和当天的聊天一起写成一页草稿；电脑没开的话，23:30 网站会自己用随手记写。'));
    const ta=el('textarea');ta.rows=4;ta.maxLength=1000;ta.placeholder='比如：午饭那家面馆换了老板，汤还是一样好喝。';ta.id='f-jot';
    const l=el('label');l.append('新的一句',ta);
    const b=el('div','bar');const s=el('button','b pri','记下');s.type='submit';b.appendChild(s);
    const cw=el('button','b','现在就用今天的随手记写一页');cw.type='button';cw.onclick=compose;b.appendChild(cw);
    const ul=el('div','jots');
    const paint=()=>{
      ul.textContent='';
      if(!jots.length){ul.appendChild(el('div','hintx','还没有记过。'));return;}
      jots.forEach(j=>{
        const d=new Date(j.createdAt);
        const row=el('div','jot'+(j.usedIn?' used':''));
        const meta=el('span','when',(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+(j.usedIn?' · 已写进手帐':''));
        const x=el('button','b small','删掉');x.type='button';
        x.onclick=async()=>{
          try{await api('/api/admin/jots/'+encodeURIComponent(j.id),{method:'DELETE'});jots=jots.filter(k=>k.id!==j.id);paint();}
          catch(e){status(e.message||'删除失败','err');}
        };
        row.append(el('p',null,j.text),meta,x);ul.appendChild(row);
      });
    };
    f.addEventListener('submit',async e=>{
      e.preventDefault();
      const text=ta.value.trim();if(!text){ta.focus();return;}
      if(busy)return;busy=true;status('正在记……');
      try{const r=await sendJson('POST','/api/admin/jots',{text});jots.unshift(r.jot);ta.value='';paint();status('记下了。','ok');}
      catch(err){status(err.message||'没记上，稍后再试。','err');}
      finally{busy=false;}
    });
    async function compose(){
      if(busy)return;busy=true;cw.disabled=true;status('Claude 正在写，大约要半分钟……');
      try{
        const r=await api('/api/admin/compose',{method:'POST'});
        entries.push(r.entry);
        busy=false;select(r.entry.id,true);status('写好了，这是草稿。看过没问题就点「发布这一页」。','ok');
      }catch(e){status(e.message||'没写成，稍后再试。','err');}
      finally{busy=false;cw.disabled=false;}
    }
    // today's page, written from these, can be locked before it's written
    const lk=el('div');
    const paintLock=()=>{lk.textContent='';if(!jotsToday)return;
      const h=el('h3','fsect','今天这一页上锁');h.style.fontSize='18px';lk.append(h,lockField('d-'+jotsToday));};
    f.append(l,b,statusEl,lk,ul);main.appendChild(f);paint();paintLock();
    (async()=>{try{const r=await api('/api/admin/jots');jots=r.jots||[];
      if(r.today){jotsToday=r.today;if(r.todayLocked)dayLocks.add(r.today);else dayLocks.delete(r.today);}
      paint();paintLock();}catch(e){status(e.message||'加载失败','err');}})();
    setTimeout(()=>ta.focus(),0);
  }

  /* ---------- 一键补全: the AI fills in the parts of the page still empty, from its words ----------
     Title, English note, header note, stamp, footer quote and doodles; what's filled in stays as it is, and
     nothing is saved until 保存. */
  const SUGGEST=[['title','标题'],['latin','英文小注'],['aside','页眉小字'],['stamp','印章'],['quote','页脚引文'],['quoteSrc','引文出处']];
  function suggestField(){
    const acts=el('div','photo-actions suggest');
    const b=el('button','b small','✨ AI 补全空着的项');b.type='button';
    const note=el('span','hintx','根据正文补上标题、英文小注、页眉小字、印章、页脚引文和插画；已经写了的不动');
    acts.append(b,note);
    b.onclick=async()=>{
      if(!String(draft.body||'').trim()){status('先写几句正文，再让 AI 补全。','err');const t=$('f-body');if(t)t.focus();return;}
      b.disabled=true;b.textContent='正在想……';status('');
      try{
        const r=await sendJson('POST','/api/admin/ai/suggest',stripLocal(draft)),g=r.suggestion||{};
        const done=[];
        SUGGEST.forEach(([k,label])=>{if(!String(draft[k]||'').trim()&&g[k]){draft[k]=g[k];done.push(label);}});
        if(!(draft.stickers||[]).length&&(g.stickers||[]).length){draft.stickers=g.stickers.slice();done.push('插画');}
        drawForm();changed();
        status(done.length?'已补全：'+done.join('、')+'。看看合不合适，可以改，记得保存。':'空着的项都有了，没有要补的。',done.length?'ok':'');
      }catch(e){b.disabled=false;b.textContent='✨ AI 补全空着的项';status(e.message||'没补全成','err');}
    };
    return acts;
  }

  /* ---------- 地点和天气: where the page was written, and that day's weather ----------
     "获取" asks the browser where it is, names the place (BigDataCloud) and looks up the page's date at those
     coordinates (Open-Meteo: forecast for the last three months and the next two weeks, the archive before
     that). Both are free and need no key; they're called from this page only. Coordinates are kept to two
     decimals (about a kilometre): the book is public. All three can be typed or cleared by hand. */
  const WMO={0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',48:'雾凇',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',56:'冻毛毛雨',57:'冻毛毛雨',
    61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'阵雨',81:'阵雨',82:'强阵雨',
    85:'阵雪',86:'阵雪',95:'雷阵雨',96:'雷阵雨伴冰雹',99:'雷阵雨伴冰雹'};
  async function weatherOn(date,lat,lon){
    const days=(Date.parse(date+'T00:00:00Z')-Date.parse(T.todayStr()+'T00:00:00Z'))/864e5;
    if(days>15)throw new Error('太远的日子还查不到天气');
    const host=days<-85?'https://archive-api.open-meteo.com/v1/archive':'https://api.open-meteo.com/v1/forecast';
    const u=host+'?latitude='+lat+'&longitude='+lon+'&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date='+date+'&end_date='+date;
    const r=await fetch(u);if(!r.ok)throw new Error('天气没查到（'+r.status+'）');
    const d=(await r.json()).daily||{},code=d.weather_code&&d.weather_code[0];
    if(code==null)throw new Error('那一天的天气还没有');
    const lo=Math.round(d.temperature_2m_min[0]),hi=Math.round(d.temperature_2m_max[0]);
    return (WMO[code]||'—')+' '+(lo===hi?hi:lo+'~'+hi)+'°';
  }
  async function placeAt(lat,lon){
    const r=await fetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='+lat+'&longitude='+lon+'&localityLanguage=zh');
    if(!r.ok)return '';
    const j=await r.json();
    const city=(j.city||j.principalSubdivision||j.countryName||'').replace(/市$/,''),near=(j.locality||'').replace(/(街道|镇|乡)$/,'');
    return [...(city&&near&&near!==city?city+' · '+near:city||near)].slice(0,30).join('');
  }
  const here=()=>new Promise((res,rej)=>{
    if(!navigator.geolocation)return rej(new Error('这个浏览器拿不到位置'));
    navigator.geolocation.getCurrentPosition(p=>res([+p.coords.latitude.toFixed(2),+p.coords.longitude.toFixed(2)]),
      e=>rej(new Error(e.code===1?'没有允许获取位置（浏览器地址栏里可以打开）':'位置没拿到，稍后再试')),{enableHighAccuracy:false,timeout:12000,maximumAge:6e5});
  });
  function placeField(){
    const wrap=el('div','placefield');
    const h=el('div','hintx');h.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';h.textContent='地点和天气（可空，写在页眉右上角）';
    const row=el('div','row');row.append(field('地点','place','text',{ph:'上海 · 徐汇',max:30}),field('天气','weather','text',{ph:'多云 18~25°',max:20}));
    const r2=el('div','row place-row');
    r2.appendChild(field('坐标（纬度,经度）','geo','text',{ph:'31.23,121.47',max:24}));
    const acts=el('div','photo-actions');
    const go=el('button','b small','📍 获取位置和天气');go.type='button';
    const wx=el('button','b small','按坐标查天气');wx.type='button';
    acts.append(go,wx);r2.appendChild(acts);
    const set=(k,v)=>{draft[k]=v;const i=$('f-'+k);if(i)i.value=v;};
    const coords=()=>{const m=/^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(draft.geo||'');return m?[+m[1],+m[2]]:null;};
    async function run(btn,fn){
      const t=btn.textContent;btn.disabled=true;btn.textContent='查询中……';
      try{await fn();changed();}catch(e){status(e.message||'没查到','err');}
      finally{btn.disabled=false;btn.textContent=t;}
    }
    go.onclick=()=>run(go,async()=>{
      status('正在获取位置……');
      const [la,lo]=await here();set('geo',la+','+lo);
      const [name,w]=await Promise.all([placeAt(la,lo).catch(()=>''),weatherOn(draft.date,la,lo).catch(e=>{status(e.message,'err');return '';})]);
      if(name)set('place',name);if(w)set('weather',w);
      if(w)status('已填好地点和天气，记得保存。','ok');
    });
    wx.onclick=()=>run(wx,async()=>{
      const c=coords();if(!c)throw new Error('先填坐标，或者点「获取位置和天气」');
      if(!T.parseDate(draft.date))throw new Error('先填日期');
      set('weather',await weatherOn(draft.date,c[0],c[1]));status('已按坐标查到 '+draft.date+' 的天气，记得保存。','ok');
    });
    wrap.append(h,row,r2,el('span','hintx','坐标只保留两位小数（大约 1 公里），因为手帐是公开的。天气按这一页的日期查。'));
    return wrap;
  }

  /* ---------- 正文: a Markdown editor ----------
     A toolbar for the marks the page understands (render.js bodyBlocks), ⌘/Ctrl+B / I / K, and Enter carrying
     a list, checklist or quote on to the next line (Enter on an empty item ends it). Edits go through
     insertText, so ⌘/Ctrl+Z undoes them. The page beside the form is the preview. */
  function mdField(){
    const wrap=el('div','mdfield');
    const lab=el('label',null,'正文');lab.htmlFor='f-body';
    const ta=el('textarea');ta.id='f-body';ta.rows=12;ta.maxLength=4000;ta.value=draft.body||'';ta.spellcheck=false;
    const on=()=>{draft.body=ta.value;changed();};
    ta.addEventListener('input',on);
    // replace [a, b) with text, then select [sa, sb) (offsets from a)
    function put(a,b,text,sa,sb){
      ta.focus();ta.setSelectionRange(a,b);
      if(!document.execCommand||!document.execCommand('insertText',false,text)){ta.setRangeText(text,a,b,'end');on();}
      ta.setSelectionRange(a+(sa==null?text.length:sa),a+(sb==null?(sa==null?text.length:sa):sb));
    }
    const sel=()=>[ta.selectionStart,ta.selectionEnd,ta.value];
    function wrapWith(pre,post,ph){
      const [a,b,v]=sel(),t=v.slice(a,b)||ph;
      put(a,b,pre+t+post,pre.length,pre.length+t.length);
    }
    // every line the selection touches gets the mark (or loses it, if they all have it)
    function lines(mark){
      const [a,b,v]=sel(),s0=v.lastIndexOf('\n',a-1)+1;let e0=v.indexOf('\n',b);if(e0<0)e0=v.length;
      const ls=v.slice(s0,e0).split('\n');
      const pre=i=>typeof mark==='function'?mark(i):mark;
      const has=ls.every((l,i)=>l.startsWith(pre(i)));
      const out=ls.map((l,i)=>has?l.slice(pre(i).length):pre(i)+l.replace(/^(\s*([-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|#{1,3}\s+))/,'')).join('\n');
      put(s0,e0,out,out.length,out.length);
    }
    // a piece on lines of its own
    function block(text,sa,sb){
      const [a,b,v]=sel(),before=a>0&&v[a-1]!=='\n'?'\n':'',after=v[b]&&v[b]!=='\n'?'\n':'';
      put(a,b,before+text+after,before.length+(sa==null?text.length:sa),before.length+(sb==null?text.length:sb));
    }
    function heading(){
      const [a,,v]=sel(),s0=v.lastIndexOf('\n',a-1)+1,m=/^(#{1,3})\s+/.exec(v.slice(s0));
      const n=m?m[1].length%3+1:1,cut=m?m[0].length:0;
      put(s0,s0+cut,(m&&m[1].length===3)?'':'#'.repeat(n)+' ');
    }
    const TOOLS=[
      ['B','粗体（⌘/Ctrl+B）',()=>wrapWith('**','**','粗体'),'b'],
      ['I','强调（⌘/Ctrl+I）',()=>wrapWith('*','*','强调'),'i'],
      ['S','删除线',()=>wrapWith('~~','~~','划掉'),'s'],
      ['H','标题（再点换大小）',heading,'h'],
      ['▰','荧光笔重点',()=>wrapWith('==','==','重点'),'hl'],
      ['•','列表',()=>lines('- ')],
      ['1.','编号',()=>lines(i=>(i+1)+'. ')],
      ['☐','清单',()=>lines('- [ ] ')],
      ['❝','便签 / 引用',()=>lines('> ')],
      ['</>','代码',()=>{const [a,b,v]=sel();if(v.slice(a,b).includes('\n')||a===b)block('```\n'+(v.slice(a,b)||'代码')+'\n```',4,4+(v.slice(a,b)||'代码').length);else wrapWith('`','`','代码');}],
      ['🔗','链接（⌘/Ctrl+K）',()=>{const [a,b,v]=sel(),t=v.slice(a,b)||'文字';put(a,b,'['+t+'](https://)',t.length+3,t.length+11);}],
      ['—','分隔线',()=>block('---')],
      ['▦','漫画格',()=>block('@09:00 做什么：说的话 #laptop',7,14)],
    ];
    const bar=el('div','mdbar');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','正文格式');
    TOOLS.forEach(([t,title,fn,cls])=>{
      const b=el('button','mdb'+(cls?' mdb-'+cls:''),t);b.type='button';b.title=title;b.setAttribute('aria-label',title);
      b.addEventListener('mousedown',e=>e.preventDefault());   // keep the selection in the text
      b.onclick=fn;bar.appendChild(b);
    });
    ta.addEventListener('keydown',e=>{
      const mod=e.metaKey||e.ctrlKey;
      if(mod&&!e.shiftKey&&!e.altKey){
        const k=e.key.toLowerCase(),t=k==='b'?TOOLS[0]:k==='i'?TOOLS[1]:k==='k'?TOOLS[10]:null;
        if(t){e.preventDefault();t[2]();}
        return;
      }
      if(e.key!=='Enter'||e.shiftKey||e.isComposing||e.keyCode===229||ta.selectionStart!==ta.selectionEnd)return;
      const v=ta.value,a=ta.selectionStart,s0=v.lastIndexOf('\n',a-1)+1;
      const m=/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) |> )(.*)$/.exec(v.slice(s0,a));
      if(!m)return;
      e.preventDefault();
      if(!m[5].trim()){put(s0,a,'');return;}          // an empty item: the list ends here
      const next=m[3]?(+m[3]+1)+m[4]+' ':m[2].replace(/\[[xX]\]/,'[ ]');
      put(a,a,'\n'+m[1]+next);
    });
    const help=el('details','mdhelp');
    help.appendChild(el('summary',null,'能写的格式'));
    const rows=[['**粗体**  *强调*  ~~划掉~~  ==重点==  `代码`','[文字](https://…) 是链接'],
      ['# 大标题  ## 中标题  ### 小标题','--- 一条虚线'],
      ['- 列表 / 1. 编号','- [ ] 没做完 / - [x] 做完了（红叉）'],
      ['> 一句话','贴一张胶带便签'],
      ['```↵ 代码 ↵```','一块深色代码'],
      ['@09:10 站会：今天修什么？ #laptop','漫画格：时间 · 在做什么、对话气泡、小插画（相邻几行排成一条）'],
      ['空一行','分段；段落里换行就是换行']];
    const tb=el('table');rows.forEach(([a,b])=>{const tr=el('tr');tr.append(el('td',null,a),el('td',null,b));tb.appendChild(tr);});
    help.appendChild(tb);
    help.appendChild(el('div','hintx','漫画格里 # 后面写小插画的名字：'+T.stickerList.map(x=>x.key+' '+x.label).join(' · ')));
    wrap.append(lab,bar,ta,el('span','hintx','没有照片时大约 250 字写满一页，再多字会自动缩小。'),help);
    return wrap;
  }

  /* ---------- photos: up to three, each with its caption ---------- */
  const MAX_PHOTOS=3;
  function photoList(){
    if(!Array.isArray(draft.photos))draft.photos=draft.photoKey?[{key:draft.photoKey,cap:draft.photoCap||'',url:draft.photoUrl}]:[];
    return draft.photos;
  }
  // the first photo is also photoKey / photoCap (what older readers of a page look at)
  function syncFirst(){const f=draft.photos[0];draft.photoKey=f?f.key:'';draft.photoCap=f?f.cap:'';delete draft.photoUrl;}
  function photoField(){
    const wrap=el('div'),list=photoList();
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';
    l.textContent='照片（可空，最多 '+MAX_PHOTOS+' 张，像拍立得一样贴在页上：一张放在字旁边，两三张在标题下面排一排）';
    wrap.appendChild(l);
    list.forEach((ph,i)=>{
      const row=el('div','photo-field');
      const th=el('div','thumb');th.style.backgroundImage='url("'+(ph.url||'/img/'+ph.key)+'")';
      const acts=el('div','photo-actions');
      if(i>0){const up=el('button','b small','往前放');up.type='button';up.onclick=()=>{list.splice(i-1,0,list.splice(i,1)[0]);syncFirst();drawForm();changed();};acts.appendChild(up);}
      const rm=el('button','b small','拿掉');rm.type='button';rm.onclick=()=>{list.splice(i,1);syncFirst();drawForm();changed();};acts.appendChild(rm);
      const cap=el('input');cap.type='text';cap.maxLength=30;cap.placeholder='照片下面的小字，比如：2023 · 海边';cap.value=ph.cap||'';
      cap.id='f-photoCap'+i;cap.setAttribute('aria-label','第 '+(i+1)+' 张照片的说明');
      cap.addEventListener('input',()=>{ph.cap=cap.value;syncFirst();changed();});
      const right=el('div');right.style.cssText='display:grid;gap:8px';right.append(cap,acts);
      row.append(th,right);wrap.appendChild(row);
    });
    if(list.length<MAX_PHOTOS){
      const acts=el('div','photo-actions');acts.style.marginTop=list.length?'8px':'0';
      const fb=el('span','b small filebtn',list.length?'再加一张':'选择照片');
      const inp=el('input');inp.type='file';inp.multiple=true;inp.accept='image/jpeg,image/png,image/webp,image/gif,image/heic';inp.id='f-photo';inp.setAttribute('aria-label','选择照片');
      fb.appendChild(inp);acts.appendChild(fb);wrap.appendChild(acts);
      inp.addEventListener('change',async()=>{
        const files=[...(inp.files||[])].slice(0,MAX_PHOTOS-list.length);if(!files.length)return;
        fb.firstChild.textContent='上传中……';status('正在压缩并上传照片……');
        try{
          for(const file of files){
            const blob=await shrink(file);
            const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
            list.push({key:r.key,cap:'',url:URL.createObjectURL(blob)});
          }
          syncFirst();drawForm();changed();status('照片已上传，记得保存这一页。','ok');
        }catch(e){syncFirst();drawForm();changed();status(e.message||'照片上传失败','err');}
      });
    }
    return wrap;
  }
  /* shrink big photos (NAS originals) to 1600px JPEG before upload */
  async function shrink(file,max=1600,keepAlpha=false){
    if(file.type==='image/gif')return file;
    let bmp;
    try{bmp=await createImageBitmap(file);}catch(e){throw new Error('这个格式浏览器打不开，请换成 JPG 或 PNG');}
    const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    if(k===1&&file.size<1.5e6&&/^image\/(jpeg|png|webp)$/.test(file.type))return file;
    const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    // cover stickers keep a transparent background: re-encode PNG / WebP as PNG, not JPEG
    const out=keepAlpha&&/^image\/(png|webp)$/.test(file.type)?['image/png']:['image/jpeg',0.86];
    return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('压缩失败')),...out));
  }

  /* ---------- save / delete ---------- */
  async function save(){
    if(busy||!draft)return false;
    if(sel==='new'&&newLock){
      if([...newLock.p1].length<4){status('口令至少 4 个字符（不想上锁就清空）。','err');const i=$('nl1');if(i)i.focus();return false;}
      if(newLock.p1!==newLock.p2){status('两次输入的口令不一样。','err');const i=$('nl2');if(i)i.focus();return false;}
    }
    if(sel!=='settings'){
      if(!T.parseDate(draft.date)){status('请填日期。','err');return false;}
      if(!String(draft.title||'').trim()){status('标题不能为空。','err');const t=$('f-title');if(t)t.focus();return false;}
    }
    busy=true;status('正在保存……');
    try{
      if(sel==='settings'){
        const r=await sendJson('PUT','/api/admin/settings',stripLocal(draft));
        settings=r.settings;aiKeySet=!!(r.ai&&r.ai.keySet);draft=Object.assign({},settings);base=JSON.stringify(draft);
        drawForm();status('已保存，刷新主页就能看到。','ok');
      }else{
        const body=stripLocal(draft);
        const r=sel==='new'?await sendJson('POST','/api/admin/entries',body):await sendJson('PUT','/api/admin/entries/'+encodeURIComponent(sel),body);
        const en=r.entry;const i=entries.findIndex(e=>e.id===en.id);
        let lockNote='';
        if(sel==='new'&&newLock){
          try{await sendJson('PUT','/api/admin/locks/'+encodeURIComponent(en.id),{password:newLock.p1});en.locked=true;lockNote='，并已上锁';}
          catch(e){lockNote='，但上锁没成功：'+(e.message||'稍后在下面「单独上锁」里再设');}
          newLock=null;
        }
        if(i>=0)en.locked=entries[i].locked;          // the lock is kept apart from the page's fields
        if(i>=0)entries[i]=en;else entries.push(en);
        // photos just uploaded keep showing from this browser's copy
        const urls=new Map((draft.photos||[]).filter(p=>p.url).map(p=>[p.key,p.url]));
        sel=en.id;draft=Object.assign({},en);
        draft.photos=(en.photos||[]).map(p=>Object.assign({},p,urls.has(p.key)?{url:urls.get(p.key)}:{}));
        base=JSON.stringify(stripLocal(draft));
        drawList();drawForm();status((en.status==='draft'?'已存为草稿，主页上还看不到':'已发布，主页刷新就能看到')+lockNote+'。',lockNote.includes('没成功')?'err':'ok');
      }
      return true;
    }catch(e){
      // a failed publish/unpublish shouldn't leave the button label lying about the state
      if(sel!=='settings'&&sel!=='new'){const en=entries.find(x=>x.id===sel);if(en)draft.status=en.status;}
      status(e.message||'保存失败，稍后再试。','err');return false;
    }
    finally{busy=false;}
  }
  async function remove(){
    if(busy)return;busy=true;status('正在删除……');
    try{
      await api('/api/admin/entries/'+encodeURIComponent(sel),{method:'DELETE'});
      entries=entries.filter(e=>e.id!==sel);sel=null;draft=null;base='';
      drawList();drawForm();
    }catch(e){status(e.message||'删除失败','err');}
    finally{busy=false;}
  }
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();save();}});
  window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});

  /* ---------- boot ---------- */
  (async()=>{
    try{
      const me=await api('/api/admin/me');
      $('who').textContent='已登录'+(me.login?' @'+me.login:'');$('logout').hidden=false;
      // all the settings, the AI's too (the public /api/settings leaves those out)
      const [e,s]=await Promise.all([api('/api/admin/entries'),api('/api/admin/settings')]);
      entries=e.entries||[];settings=s.settings||{};aiKeySet=!!(s.ai&&s.ai.keySet);bookLocked=!!e.bookLocked;
      entries.forEach(en=>{if(en.dayLocked)dayLocks.add(en.date);});
      drawList();drawForm();
    }catch(err){
      // not signed in, or the Worker can't do sign-in yet (e.g. GitHub app not configured): either way, the login sheet says why
      if(!$('gate').hidden)return;
      gate();$('gateMsg').textContent=err.message||'加载失败，刷新再试。';
    }
  })();
})();
