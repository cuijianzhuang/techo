/* Admin for the journal: write pages, upload photos to R2, edit contact info. */
(function(){
  "use strict";
  const T=window.Techo,{el}=T;
  const $=id=>document.getElementById(id);
  const main=$('main'),list=$('list');
  let entries=[],settings={},jots=[],bookLocked=false,newLock=null;
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
  const plain=en=>[en.title,en.latin,en.aside,en.body,en.note,en.quote,en.date,en.date.replace(/-0?/g,'/')].join('\n').toLowerCase();
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
      const meta=el('span',null,(d?d.mo+'/'+d.d:en.date)+(en.photoKey?' · 有照片':'')+(en.locked?' · 🔒 单独上锁':dayLocks.has(en.date)?' · 🔒 这一天上锁':''));
      const gist=String(en.body||'').replace(/\s+/g,' ').trim();
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
  function stripLocal(d){const c=Object.assign({},d);delete c.photoUrl;return c;}

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
    else if(id==='new'){newLock=null;draft={date:T.todayStr(),title:'',latin:'',stamp:'',aside:'',body:'',note:'',mood:'mug',quote:'',quoteSrc:'',photoKey:'',photoCap:'',stickers:[],status:'published'};}
    else{const en=entries.find(e=>e.id===id);draft=en?Object.assign({},en):null;}
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
    f.append(r1,r2,field('正文','body','textarea',{rows:10,max:4000,hint:'空一行分段。没有照片时大约 250 字写满一页，再多字会自动缩小。'}));
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
    [['3d','立体的书','有厚度和光影，纸从页角卷起翻过去（默认）'],['flip','平面翻页','轻一些的翻页效果；不支持立体效果的设备也会用它']].forEach(([v,name,hint])=>{
      const l=el('label','check1');
      const r=el('input');r.type='radio';r.name='f-bookmode';r.value=v;r.checked=(draft.bookMode||'3d')===v;
      r.onchange=()=>{if(r.checked){draft.bookMode=v;changed();}};
      l.append(r,el('span',null,name));w.append(l,el('div','hintx',hint));
    });
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

  /* ---------- photo ---------- */
  function photoField(){
    const wrap=el('div');
    const l=el('div','hintx');l.style.cssText='font:500 12px/1.2 var(--print);margin-bottom:5px';l.textContent='照片（可空，会像拍立得一样贴在页上）';
    const row=el('div','photo-field');
    const th=el('div','thumb');
    const setThumb=()=>{const u=draft.photoUrl||(draft.photoKey?'/img/'+draft.photoKey:'');th.style.backgroundImage=u?'url("'+u+'")':'';};
    setThumb();
    const acts=el('div','photo-actions');
    const fb=el('span','b small filebtn',draft.photoKey?'换一张':'选择照片');
    const inp=el('input');inp.type='file';inp.accept='image/jpeg,image/png,image/webp,image/gif,image/heic';inp.id='f-photo';inp.setAttribute('aria-label','选择照片');
    fb.appendChild(inp);acts.appendChild(fb);
    if(draft.photoKey){const rm=el('button','b small','拿掉照片');rm.type='button';rm.onclick=()=>{draft.photoKey='';draft.photoUrl='';setThumb();drawForm();changed();};acts.appendChild(rm);}
    const cap=el('input');cap.type='text';cap.maxLength=30;cap.placeholder='照片下面的小字，比如：2023 · 海边';cap.value=draft.photoCap||'';cap.id='f-photoCap';
    cap.addEventListener('input',()=>{draft.photoCap=cap.value;changed();});
    const right=el('div');right.style.cssText='display:grid;gap:8px';right.append(acts,cap);
    row.append(th,right);wrap.append(l,row);
    inp.addEventListener('change',async()=>{
      const file=inp.files&&inp.files[0];if(!file)return;
      fb.firstChild.textContent='上传中……';status('正在压缩并上传照片……');
      try{
        const blob=await shrink(file);
        const r=await api('/api/admin/photos',{method:'POST',headers:{'content-type':blob.type,accept:'application/json'},body:blob});
        draft.photoKey=r.key;draft.photoUrl=URL.createObjectURL(blob);
        setThumb();drawForm();changed();status('照片已上传，记得保存这一页。','ok');
      }catch(e){fb.firstChild.textContent='选择照片';status(e.message||'照片上传失败','err');}
    });
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
        settings=r.settings;draft=Object.assign({},settings);base=JSON.stringify(draft);
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
        const keepUrl=draft.photoUrl;
        sel=en.id;draft=Object.assign({},en);if(keepUrl&&draft.photoKey)draft.photoUrl=keepUrl;
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
      const [e,s]=await Promise.all([api('/api/admin/entries'),api('/api/settings')]);
      entries=e.entries||[];settings=s.settings||{};bookLocked=!!e.bookLocked;
      entries.forEach(en=>{if(en.dayLocked)dayLocks.add(en.date);});
      drawList();drawForm();
    }catch(err){
      // not signed in, or the Worker can't do sign-in yet (e.g. GitHub app not configured): either way, the login sheet says why
      if(!$('gate').hidden)return;
      gate();$('gateMsg').textContent=err.message||'加载失败，刷新再试。';
    }
  })();
})();
