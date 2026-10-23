(()=>{'use strict';
const KEY='dw2-lt-v2',OLD='dw2-lt-v1',ID='dw2-lt-root';
let state={items:[],x:18,y:110,side:'right',visible:true,minimized:false,bgTunerEnabled:false},root,ball,tray,observer,scanTimer,drag=null,open=false;
const hidden=new Map(),tracked=new WeakSet();
try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s)state={...state,...s};else{const old=JSON.parse(localStorage.getItem(OLD)||'null');if(old)state.x=old.x??18,state.y=old.y??110}}catch{}
if(state.wandHidden===true)state.minimized=true;delete state.wandHidden;
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}};
// Persist auto-floor settings in the existing Little Things key, never a second store.
// Module master switches use the existing dw2-lt-v2 store; keep older preferences intact.
state.floatEnabled=typeof state.floatEnabled==='boolean'?state.floatEnabled:state.visible!==false;
state.floorEnabled=state.floorEnabled!==false;
state.autoFloorEnabled=state.autoFloorEnabled===true;
state.autoFloorMode=state.autoFloorMode==='custom'?'custom':'50';
state.autoFloorCustom=Number.isSafeInteger(Number(state.autoFloorCustom))&&Number(state.autoFloorCustom)>=10&&Number(state.autoFloorCustom)<=5000?Number(state.autoFloorCustom):50;

// ============================================================
// DW2 · Little Things / Background Tuner
// Self-contained module adapted from the user's proven Lite v2.13.
// No TavernHelper, jQuery, injected script, or global touch listeners.
// ============================================================
const background=(()=>{
 const STORE='st_bg_lite_v212',THEME_KEY='st_bg_lite_v212_panel_theme';
 const PANEL='dw2-lt-bg-panel',ACTIVE_CLASS='dw2-lt-bg-tuned';
 let active=false,watch=0,currentKey='',preview=false,panel=null;
 let values={bright:50,clarity:100},theme='night';
 // Only mutate this module's own CSS custom properties, preserving theme filters.
 const tunedLayers=new Map();
 function preserveLayer(el){
  if(tunedLayers.has(el))return;
  const read=name=>({value:el.style.getPropertyValue(name),priority:el.style.getPropertyPriority(name)});
  tunedLayers.set(el,{alpha:read('--dw2-lt-bg-alpha'),blur:read('--dw2-lt-bg-backdrop'),classPresent:el.classList.contains(ACTIVE_CLASS)});
 }
 function restoreTunedLayers(){
  for(const [el,old] of tunedLayers){
   for(const [key,name] of [['alpha','--dw2-lt-bg-alpha'],['blur','--dw2-lt-bg-backdrop']]){
    const saved=old[key];
    if(saved.value)el.style.setProperty(name,saved.value,saved.priority);
    else el.style.removeProperty(name);
   }
   if(!old.classPresent)el.classList.remove(ACTIVE_CLASS);
  }
  tunedLayers.clear();
 }
 try{theme=localStorage.getItem(THEME_KEY)==='day'?'day':'night'}catch{}
 const byId=id=>document.getElementById(id);
 const clamp=n=>Math.max(0,Math.min(100,Number.isFinite(Number(n))?Number(n):50));
 const layers=()=>[byId('bg1'),byId('bg2')].filter(Boolean);
 function imageKey(){
  const items=layers().map((el,index)=>{
   const computed=getComputedStyle(el);
   return {image:computed.backgroundImage||'none',opacity:Number(computed.opacity)||0,index};
  });
  if(!items.length)return '__default__';
  items.sort((a,b)=>b.opacity-a.opacity || Number(b.image!=='none')-Number(a.image!=='none') || b.index-a.index);
  return items[0].image||'__default__';
 }
 function load(){
  values={bright:50,clarity:100};
  try{
   const data=JSON.parse(localStorage.getItem(STORE)||'{}')[currentKey]||{};
   if(data.bright!==undefined)values.bright=clamp(data.bright);
   if(data.clarity!==undefined)values.clarity=clamp(data.clarity);
  }catch{}
 }
 function persist(){
  try{
   const all=JSON.parse(localStorage.getItem(STORE)||'{}');
   all[currentKey]={bright:values.bright,clarity:values.clarity};
   localStorage.setItem(STORE,JSON.stringify(all));
  }catch{}
 }
 // Tint within #bg1's own geometry, which TT 2.4 sizes to its native window.
 // A separate fixed div could be clipped at the WebView / safe-area boundary.
 function applyWallpaperEffects(){
  const alpha=preview?0:(100-values.bright)/100;
  const blur=preview?0:(100-values.clarity)*0.15;
  for(const el of layers()){
   preserveLayer(el);
   el.style.setProperty('--dw2-lt-bg-alpha',String(alpha));
   el.style.setProperty('--dw2-lt-bg-backdrop',blur>0?'blur('+blur+'px)':'none');
   el.classList.add(ACTIVE_CLASS);
  }
 }

 // iOS TT 2.4 draws the safe area with UIKit UIImageViews outside the WebView.
 // For iOS only, render a disposable tinted copy for TT's native backdrop API.
 // Never replace the user's actual wallpaper, settings or original image.
 const isIosHost=/iPhone|iPad|iPod/.test(navigator.userAgent)||
  (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const nativeTempKey='dw2-lt-ios-temp-previews';
 let nativeTemp='',nativeTimer=0,nativeTicket=0,nativeLast='',nativeJobs=Promise.resolve(),nativeErrorShown=false;
 function nativeTemps(){
  try{return JSON.parse(localStorage.getItem(nativeTempKey)||'[]').filter(s=>typeof s==='string'&&/^__dw2_lt_ios_[a-z0-9_]+\.png$/.test(s)).slice(-12)}catch{return []}
 }
 function rememberNative(name){
  try{localStorage.setItem(nativeTempKey,JSON.stringify([...new Set([...nativeTemps(),name])].slice(-12)))}catch{}
 }
 function forgetNative(name){
  try{localStorage.setItem(nativeTempKey,JSON.stringify(nativeTemps().filter(x=>x!==name)))}catch{}
 }
 async function nativeApi(){
  const invoke=window.__TAURI__?.core?.invoke;
  if(typeof invoke!=='function')throw Error('TT iOS native bridge unavailable');
  const [{getWindowSnapshot},{getBackgroundPath},{getRequestHeaders}]=await Promise.all([
   import('../../../util/window-layout.js'),import('../../../backgrounds.js'),import('../../../script.js'),
  ]);
  return {invoke,snapshot:getWindowSnapshot(),getBackgroundPath,getRequestHeaders};
 }
 function bgSpec(){
  const bg=byId('bg1');if(!bg)return null;
  const s=getComputedStyle(bg),m=/^url\(["']?(.*?)["']?\)$/.exec(s.backgroundImage);
  if(!m)return null;
  const url=new URL(m[1],location.href);
  if(url.origin!==location.origin)return null;
  return {url:url.href,path:url.pathname,size:s.backgroundSize,position:s.backgroundPosition};
 }
 function bodyRGB(){
  const c=document.createElement('canvas');c.width=c.height=1;
  const x=c.getContext('2d');if(!x)return [0,0,0];
  x.fillStyle='white';x.fillRect(0,0,1,1);
  x.fillStyle=getComputedStyle(document.body).backgroundColor;x.fillRect(0,0,1,1);
  return [...x.getImageData(0,0,1,1).data].slice(0,3);
 }
 async function publishNative(api,path,size='cover',position='50% 50%'){
  if(!api.snapshot)return;
  await api.invoke('set_window_backdrop',{request:{
   windowRevision:api.snapshot.revision,color:bodyRGB(),
   wallpaper:{resourcePath:path,size,position},
  }});
 }
 async function deleteNativeTemp(api,name){
  if(!name)return;
  try{
   const res=await fetch('/api/backgrounds/delete',{
    method:'POST',headers:api.getRequestHeaders(),body:JSON.stringify({bg:name}),
   });
   if(!res.ok)throw Error('HTTP '+res.status);
   forgetNative(name);
  }catch(e){console.warn('[DW2 Little Things] iOS temp cleanup:',e)}
 }
 async function restoreNative(api){
  const s=bgSpec();
  await publishNative(api,s?.path||null,s?.size||'cover',s?.position||'50% 50%');
 }
 async function tintBlob(s,alpha,blur){
  const response=await fetch(s.url,{cache:'no-store'});
  if(!response.ok)throw Error('Wallpaper HTTP '+response.status);
  const source=await response.blob();
  let bmp=null,img=null,blobUrl='';
  try{
   if(typeof createImageBitmap==='function'){
    try{bmp=await createImageBitmap(source)}catch{}
   }
   if(bmp)img=bmp;
   else{
    blobUrl=URL.createObjectURL(source);
    img=await new Promise((resolve,reject)=>{
     const el=new Image();
     el.onload=()=>resolve(el);
     el.onerror=()=>reject(Error('Wallpaper decode failed'));
     el.src=blobUrl;
    });
   }
   const w=img.width,h=img.height;
   if(!w||!h)throw Error('Empty wallpaper');
   const scale=Math.min(1,2048/Math.max(w,h));
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(w*scale));
   canvas.height=Math.max(1,Math.round(h*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas unavailable');
   if(blur>0)ctx.filter='blur('+Math.max(.1,blur*scale).toFixed(2)+'px)';
   ctx.drawImage(img,0,0,canvas.width,canvas.height);
   ctx.filter='none';
   if(alpha>0){
    ctx.globalCompositeOperation='source-atop';
    ctx.fillStyle='rgba(0,0,0,'+alpha+')';
    ctx.fillRect(0,0,canvas.width,canvas.height);
   }
   return await new Promise((resolve,reject)=>canvas.toBlob(
    blob=>blob?resolve(blob):reject(Error('Wallpaper encode failed')),'image/png'));
  }finally{bmp?.close?.();if(blobUrl)URL.revokeObjectURL(blobUrl)}
 }
 async function syncNative(ticket){
  if(!active||ticket!==nativeTicket)return;
  const api=await nativeApi();
  if(!api.snapshot)return;
  const spec=bgSpec();
  const bright=preview?100:values.bright,clarity=preview?100:values.clarity;
  const key=JSON.stringify([spec?.url,bright,clarity,api.snapshot.revision,spec?.size,spec?.position]);
  if(key===nativeLast)return;
  if(!spec||bright===100&&clarity===100){
   await restoreNative(api);
   if(active&&ticket===nativeTicket)nativeLast=key;
   return;
  }
  if(bright===0){
   await publishNative(api,null,spec.size,spec.position);
   if(active&&ticket===nativeTicket)nativeLast=key;
   return;
  }
  const blob=await tintBlob(spec,(100-bright)/100,(100-clarity)*.15);
  if(!active||ticket!==nativeTicket)return;
  if(!nativeTemp){
   nativeTemp='__dw2_lt_ios_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10)+'.png';
   rememberNative(nativeTemp);
  }
  const body=new FormData();
  body.set('avatar',new File([blob],nativeTemp,{type:'image/png'}));
  const response=await fetch('/api/backgrounds/upload',{
   method:'POST',headers:api.getRequestHeaders({omitContentType:true}),body,
  });
  if(!response.ok)throw Error('Preview upload HTTP '+response.status);
  const saved=(await response.text()).trim();
  if(saved!==nativeTemp)throw Error('Preview storage returned an unexpected filename');
  if(!active||ticket!==nativeTicket)return;
  const path=new URL(api.getBackgroundPath(saved),location.href).pathname;
  await publishNative(api,path,spec.size,spec.position);
  if(active&&ticket===nativeTicket)nativeLast=key;
 }
 function queueNative(){
  if(!isIosHost||!active)return;
  nativeTicket++;nativeLast='';
  if(nativeTimer)clearTimeout(nativeTimer);
  const ticket=nativeTicket;
  nativeTimer=window.setTimeout(()=>{
   nativeTimer=0;
   nativeJobs=nativeJobs.catch(()=>{}).then(()=>syncNative(ticket)).catch(e=>{
    console.warn('[DW2 Little Things] native backdrop:',e);
    if(active&&ticket===nativeTicket&&!nativeErrorShown){
     nativeErrorShown=true;
     notify('iOS 全屏背景同步失败，已安全关闭背景调节；原图与设置未修改。','warning');
     disable();
    }
   });
  },700);
 }
 async function cleanOldNativeTemps(){
  if(!isIosHost)return;
  try{
   const api=await nativeApi();
   for(const name of nativeTemps().filter(x=>x!==nativeTemp))await deleteNativeTemp(api,name);
  }catch(e){console.warn('[DW2 Little Things] previous preview cleanup:',e)}
 }
 function stopNative(){
  if(!isIosHost)return;
  nativeTicket++;nativeLast='';
  if(nativeTimer){clearTimeout(nativeTimer);nativeTimer=0}
  window.removeEventListener('tt-window-changed',queueNative);
  const saved=nativeTemp;nativeTemp='';
  nativeJobs=nativeJobs.catch(()=>{}).then(async()=>{
   try{
    const api=await nativeApi();
    await restoreNative(api);
    await deleteNativeTemp(api,saved);
   }catch(e){console.warn('[DW2 Little Things] native restore:',e)}
  });
 }
 function updateControls(){
  if(!panel)return;
  for(const [key,id] of [['bright','bright'],['clarity','clarity']]){
   const slider=byId('dw2-lt-bg-'+id);
   const number=byId('dw2-lt-bg-val-'+id);
   if(slider){slider.value=String(values[key]);slider.style.setProperty('--dw2-lt-range-percent',values[key]+'%')}
   if(number)number.textContent=String(values[key]);
  }
 }
 function apply(){
  if(!active)return;
  applyWallpaperEffects();
  queueNative();
  updateControls();
 }
 function resetIndicators(){
  if(!panel)return;
  byId('dw2-lt-bg-preview')?.classList.remove('is-active');
  panel.querySelectorAll('.dw2-lt-bg-preset').forEach(el=>el.classList.remove('is-active'));
 }
 function readNewImage(){
  const next=imageKey();
  if(next!==currentKey){
   currentKey=next;
   preview=false;load();resetIndicators();
   apply();
  }else{
   if(layers().some(el=>!tunedLayers.has(el)||!el.classList.contains(ACTIVE_CLASS)))apply();
  }
 }
 function legacyRunning(){
  return !!(byId('st-bg-lite-v212-style')||byId('st-bg-lite-v212-overlay')||byId('st-bg-lite-v212-panel'));
 }
 function start(){
  if(active)return true;
  if(legacyRunning()){
   notify('检测到旧版 🌙背景调节脚本仍在运行，请先禁用旧脚本、刷新酒馆，再启用内置背景调节。','warning');
   return false;
  }
  active=true;
  nativeErrorShown=false;
  if(isIosHost){window.addEventListener('tt-window-changed',queueNative);cleanOldNativeTemps()}
  currentKey=imageKey();
  load();
  apply();
  watch=window.setInterval(()=>{if(active&&document.visibilityState!=='hidden')readNewImage()},1500);
  return true;
 }
 function stop(){
  active=false;
  if(watch){clearInterval(watch);watch=0}
  stopNative();
  panel?.remove();panel=null;
  restoreTunedLayers();
  preview=false;
 }
 function saveEnabled(flag){
  state.bgTunerEnabled=!!flag;save();
  const checkbox=byId('dw2-lt-bg-enabled');
  if(checkbox)checkbox.checked=!!flag;
 }
 function enable(){
  if(start()){saveEnabled(true);return true}
  saveEnabled(false);return false;
 }
 function disable(){stop();saveEnabled(false)}
 function setTheme(value){
  theme=value==='day'?'day':'night';
  if(panel){
   panel.dataset.theme=theme;
   panel.querySelectorAll('.dw2-lt-bg-theme-btn').forEach(b=>b.classList.toggle('is-active',b.dataset.panelTheme===theme));
  }
  try{localStorage.setItem(THEME_KEY,theme)}catch{}
 }
 function makePanel(){
  if(panel?.isConnected)return panel;
  const template=document.createElement('template');
  template.innerHTML="\n            <div id=\"dw2-lt-bg-panel\" data-theme=\"night\">\n                <div class=\"dw2-lt-bg-header\">\n                    <div class=\"dw2-lt-bg-title-wrap\">\n                        <span class=\"dw2-lt-bg-kicker\">\n                            BACKGROUND / ADJUST\n                        </span>\n                        <span class=\"dw2-lt-bg-title\">\n                            背景调节\n                        </span>\n                    </div>\n\n                    <div class=\"dw2-lt-bg-head-actions\">\n                        <div\n                            class=\"dw2-lt-bg-theme-switch\"\n                            aria-label=\"面板日夜模式\"\n                        >\n                            <button\n                                type=\"button\"\n                                class=\"dw2-lt-bg-theme-btn\"\n                                data-panel-theme=\"day\"\n                                title=\"日间面板\"\n                            >☼</button>\n\n                            <button\n                                type=\"button\"\n                                class=\"dw2-lt-bg-theme-btn\"\n                                data-panel-theme=\"night\"\n                                title=\"夜间面板\"\n                            >☾</button>\n                        </div>\n\n                        <button\n                            id=\"dw2-lt-bg-close\"\n                            class=\"dw2-lt-bg-close\"\n                            type=\"button\"\n                            title=\"关闭\"\n                            aria-label=\"关闭背景调节\"\n                        ><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M6.5 6.5 17.5 17.5 M17.5 6.5 6.5 17.5\"></path></svg></button>\n                    </div>\n                </div>\n\n                <div class=\"dw2-lt-bg-control\">\n                    <div class=\"dw2-lt-bg-label\">\n                        <span class=\"dw2-lt-bg-name\">\n                            亮度调节\n                            <span\n                                class=\"dw2-lt-bg-value\"\n                                id=\"dw2-lt-bg-val-bright\"\n                            >50</span>\n                        </span>\n\n                        <span\n                            class=\"dw2-lt-bg-reset\"\n                            id=\"dw2-lt-bg-reset-bright\"\n                        >恢复</span>\n                    </div>\n\n                    <input\n                        type=\"range\"\n                        id=\"dw2-lt-bg-bright\"\n                        min=\"0\"\n                        max=\"100\"\n                        step=\"1\"\n                        value=\"50\"\n                    >\n\n                    <div class=\"dw2-lt-bg-hint\">\n                        <span>暗</span>\n                        <span>50</span>\n                        <span>亮</span>\n                    </div>\n                </div>\n\n                <div class=\"dw2-lt-bg-control\">\n                    <div class=\"dw2-lt-bg-label\">\n                        <span class=\"dw2-lt-bg-name\">\n                            清晰度调节\n                            <span\n                                class=\"dw2-lt-bg-value\"\n                                id=\"dw2-lt-bg-val-clarity\"\n                            >100</span>\n                        </span>\n\n                        <span\n                            class=\"dw2-lt-bg-reset\"\n                            id=\"dw2-lt-bg-reset-clarity\"\n                        >恢复</span>\n                    </div>\n\n                    <input\n                        type=\"range\"\n                        id=\"dw2-lt-bg-clarity\"\n                        min=\"0\"\n                        max=\"100\"\n                        step=\"1\"\n                        value=\"100\"\n                    >\n\n                    <div class=\"dw2-lt-bg-hint\">\n                        <span>柔</span>\n                        <span>50</span>\n                        <span>清</span>\n                    </div>\n                </div>\n\n                <div class=\"dw2-lt-bg-presets\">\n                    <button\n                        type=\"button\"\n                        class=\"dw2-lt-bg-preset\"\n                        data-preset=\"original\"\n                    >原图</button>\n\n                    <button\n                        type=\"button\"\n                        class=\"dw2-lt-bg-preset\"\n                        data-preset=\"night\"\n                    >夜间</button>\n\n                    <button\n                        type=\"button\"\n                        class=\"dw2-lt-bg-preset\"\n                        data-preset=\"soft\"\n                    >柔和</button>\n                </div>\n\n                <div class=\"dw2-lt-bg-footer\">\n                    <button\n                        type=\"button\"\n                        class=\"dw2-lt-bg-action\"\n                        id=\"dw2-lt-bg-preview\"\n                    >临时原图</button>\n\n                    <button\n                        type=\"button\"\n                        class=\"dw2-lt-bg-action\"\n                        id=\"dw2-lt-bg-reset-all\"\n                    >全部恢复</button>\n                </div>\n\n                <div class=\"dw2-lt-bg-memory\">\n                    当前背景独立记忆 · 自动保存\n                </div>\n            </div>\n        ";
  panel=template.content.firstElementChild;
  panel.dataset.theme=theme;
  document.body.append(panel);
  setTheme(theme);
  updateControls();
  panel.addEventListener('input',event=>{
   if(!event.target.matches('input[type="range"]'))return;
   preview=false;resetIndicators();
   values.bright=clamp(byId('dw2-lt-bg-bright')?.value);
   values.clarity=clamp(byId('dw2-lt-bg-clarity')?.value);
   apply();persist();
  });
  panel.addEventListener('click',event=>{
   const target=event.target.closest('button,.dw2-lt-bg-close,.dw2-lt-bg-reset');
   if(!target||!panel.contains(target))return;
   const id=target.id;
   if(id==='dw2-lt-bg-close'){panel.style.display='none';return}
   if(id==='dw2-lt-bg-reset-bright'){
    preview=false;resetIndicators();values.bright=50;
   }else if(id==='dw2-lt-bg-reset-clarity'){
    preview=false;resetIndicators();values.clarity=100;
   }else if(id==='dw2-lt-bg-reset-all'){
    preview=false;resetIndicators();values={bright:50,clarity:100};
   }else if(id==='dw2-lt-bg-preview'){
    preview=!preview;resetIndicators();target.classList.toggle('is-active',preview);
    apply();return;
   }else if(target.dataset.preset){
    preview=false;resetIndicators();
    if(target.dataset.preset==='original')values={bright:100,clarity:100};
    else if(target.dataset.preset==='night')values={bright:38,clarity:100};
    else if(target.dataset.preset==='soft')values={bright:60,clarity:78};
    target.classList.add('is-active');
   }else if(target.dataset.panelTheme){
    setTheme(target.dataset.panelTheme);return;
   }else return;
   apply();persist();
  });
  return panel;
 }
 function openPanel(){
  if(!active&&!enable())return false;
  if(!panel?.isConnected)makePanel();
  panel.style.display='flex';
  return true;
 }
 function init(){if(state.bgTunerEnabled&&!start())saveEnabled(false)}
 return {init,enable,disable,open:openPanel,stop,isActive:()=>active};
})();

const cssEscape=s=>window.CSS?.escape?CSS.escape(s):s.replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c);
const query=s=>{try{return document.querySelector(s)}catch{return null}};
const valid=el=>el&&el.isConnected&&!root?.contains(el)&&el!==document.body&&el!==document.documentElement;
const rect=el=>el.getBoundingClientRect();
function candidate(el){if(!valid(el)||el.closest('#dw2-lt-root'))return false;const cs=getComputedStyle(el),r=rect(el);if(r.width<22||r.height<22||r.width>125||r.height>125||cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0)return false;
if(el.closest('header,nav,#top-bar,#top-settings-holder,.drawer,.modal,.popup'))return false;
if(el.matches('[data-tt-mobile-surface="free-window"]'))return true;
if(!['fixed','absolute'].includes(cs.position))return false;
if(cs.position==='absolute'&&!el.closest('[data-tt-mobile-surface="free-window"]')&&!Array.from((function*(n){while(n&&n!==document.body){yield n;n=n.parentElement}})(el.parentElement)).some(n=>getComputedStyle(n).position==='fixed'))return false;
return !!(el.matches('button,[role="button"],img,iframe')||el.querySelector('button,[role="button"],img,svg,iframe'))}
function selector(el){if(el.id)return '#'+cssEscape(el.id);let p=[],n=el;while(n&&n!==document.body&&p.length<8){if(n.id){p.unshift('#'+cssEscape(n.id));break}const tag=n.tagName.toLowerCase(),sib=[...(n.parentElement?.children||[])].filter(x=>x.tagName===n.tagName);p.unshift(tag+(sib.length>1?':nth-of-type('+(sib.indexOf(n)+1)+')':''));n=n.parentElement}return p.join(' > ')}
function resolve(item){const original=query(item.selector);const presetRoot=document.getElementById('dw2-preset-console');const launcher=presetRoot?.querySelector('.dw2pc-launcher');if(launcher&&(original===presetRoot||original&&presetRoot?.contains(original)||item.selector?.includes('dw2-preset-console'))){if(original&&original!==launcher&&hidden.has(original))show(original);if(item.selector!==selector(launcher)){item.selector=selector(launcher);item.clickSelector=item.selector;save()}return launcher}return original}
function clickTarget(item,el){const target=item.clickSelector?query(item.clickSelector):null;if(target&&(target===el||el.contains(target)))return target;return el.querySelector('button,[role="button"],a,[onclick],input[type="button"],input[type="submit"]')||el}
function outerCandidate(el){if(el.closest?.('#dw2-preset-console'))return el.closest('#dw2-preset-console').querySelector('.dw2pc-launcher')||el;let chosen=el;for(let n=el.parentElement;n&&n!==document.body;n=n.parentElement){if(!candidate(n))continue;const a=rect(chosen),b=rect(n);if(b.width<=150&&b.height<=150&&b.width<=a.width*2.5&&b.height<=a.height*2.5)chosen=n}return chosen}
function hide(el){if(!valid(el))return;let record=hidden.get(el);if(!record){record={value:el.style.getPropertyValue('display'),priority:el.style.getPropertyPriority('display'),observer:null,busy:false};hidden.set(el,record);const mo=new MutationObserver(()=>{if(record.busy||!hidden.has(el))return;if(el.style.getPropertyValue('display')!=='none'||el.style.getPropertyPriority('display')!=='important'){record.busy=true;el.style.setProperty('display','none','important');record.busy=false}});mo.observe(el,{attributes:true,attributeFilter:['style','class']});record.observer=mo}el.style.setProperty('display','none','important')}
function show(el){const v=hidden.get(el);if(!v)return;v.observer?.disconnect();if(v.value)el.style.setProperty('display',v.value,v.priority);else el.style.removeProperty('display');hidden.delete(el)}
function deepTarget(el){if(!el)return null;const r=rect(el);for(const group of ['button,a,[role="button"],[onclick]','img,svg,i,span']){for(const n of el.querySelectorAll(group)){const cs=getComputedStyle(n),b=rect(n);if(cs.display!=='none'&&cs.pointerEvents!=='none'&&b.width>0&&b.height>0&&b.left<r.right&&b.right>r.left&&b.top<r.bottom&&b.bottom>r.top)return n}}return el}
function activate(item,el){const preset=el.matches?.('#dw2-preset-console .dw2pc-launcher');if(preset){try{el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:0}))}catch{}return}const saved=hidden.has(el),record=hidden.get(el);record?.observer?.disconnect();const previousVisibility=el.style.getPropertyValue('visibility'),visibilityPriority=el.style.getPropertyPriority('visibility');try{if(saved){show(el);el.style.setProperty('visibility','hidden','important');void el.offsetWidth}const presetLauncher=el.matches?.('#dw2-preset-console .dw2pc-launcher')?el:el.querySelector?.('#dw2-preset-console .dw2pc-launcher')||((el.closest?.('#dw2-preset-console'))?el.closest('#dw2-preset-console').querySelector('.dw2pc-launcher'):null);const action=presetLauncher||clickTarget(item,el),target=presetLauncher||deepTarget(action)||action,r=rect(action);const x=r.left+r.width/2,y=r.top+r.height/2,base={bubbles:true,cancelable:true,clientX:x,clientY:y,screenX:x,screenY:y,button:0,buttons:1};let prevented=false;const fire=e=>{target.dispatchEvent(e);if(e.defaultPrevented)prevented=true};if(presetLauncher){const p={...base,pointerId:987654,pointerType:'touch',isPrimary:true};target.dispatchEvent(new PointerEvent('pointerdown',p));target.dispatchEvent(new PointerEvent('pointerup',{...p,buttons:0}));return}const touchCapable=navigator.maxTouchPoints>0||'ontouchstart'in window;let touch=null;if(touchCapable&&typeof Touch==='function'&&typeof TouchEvent==='function'){try{touch=new Touch({identifier:1,target,clientX:x,clientY:y,pageX:x,pageY:y,screenX:x,screenY:y})}catch{}}if(typeof PointerEvent==='function')fire(new PointerEvent('pointerdown',{...base,pointerId:1,pointerType:touch?'touch':'mouse',isPrimary:true}));if(touch)fire(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[touch],targetTouches:[touch],changedTouches:[touch]}));if(typeof PointerEvent==='function')fire(new PointerEvent('pointerup',{...base,pointerId:1,pointerType:touch?'touch':'mouse',isPrimary:true,buttons:0}));if(touch){fire(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],targetTouches:[],changedTouches:[touch]}));if(!prevented)target.click()}else{fire(new MouseEvent('mousedown',base));fire(new MouseEvent('mouseup',{...base,buttons:0}));target.click()}}catch{try{clickTarget(item,el).click()}catch{}}finally{setTimeout(()=>{if(previousVisibility)el.style.setProperty('visibility',previousVisibility,visibilityPriority);else el.style.removeProperty('visibility');if(saved&&state.floatEnabled&&valid(el))hide(el)},150)}}
function restoreAll(){for(const el of [...hidden.keys()])show(el)}
function visual(el){const wrap=document.createElement('span');wrap.className='dw2-lt-visual';if(!el)return wrap;const wasHidden=hidden.has(el);if(wasHidden)show(el);const clone=el.cloneNode(true);clone.querySelectorAll?.('[id]').forEach(n=>n.removeAttribute('id'));clone.removeAttribute('id');clone.querySelectorAll?.('script,iframe,video,audio').forEach(n=>n.remove());const original=[el,...el.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];original.slice(0,70).forEach((n,i)=>{const c=copies[i];if(!c)return;const s=getComputedStyle(n);for(const prop of ['background','background-color','background-image','background-size','background-position','border','border-radius','box-shadow','color','font-size','font-family','font-weight','opacity','object-fit'])try{c.style.setProperty(prop,s.getPropertyValue(prop))}catch{};c.style.position='relative';c.style.left='auto';c.style.top='auto';c.style.right='auto';c.style.bottom='auto';c.style.transform='none';});clone.style.width='100%';clone.style.height='100%';clone.style.margin='0';clone.style.pointerEvents='none';wrap.append(clone);if(wasHidden)hide(el);return wrap}
function render(){if(!root)return;tray.replaceChildren();
const tool=document.createElement('button');tool.className='dw2-lt-tool';tool.type='button';tool.title='背景调节';tool.setAttribute('aria-label','打开背景调节');
tool.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/></svg>';
tool.onclick=()=>{open=false;tray.hidden=true;position();background.open()};tray.append(tool);
for(const item of state.items){const b=document.createElement('button');b.className='dw2-lt-item';b.title=item.name;b.append(visual(resolve(item)));b.onclick=()=>{const el=resolve(item);if(!el){b.title='原悬浮球暂时未找到';return}open=false;tray.hidden=true;position();activate(item,el);setTimeout(sync,300)};const remove=document.createElement('span');remove.className='dw2-lt-remove';remove.textContent='×';remove.title='取出';remove.onclick=e=>{e.stopPropagation();const el=resolve(item);if(el)show(el);state.items=state.items.filter(x=>x!==item);save();render()};b.append(remove);tray.append(b)}if(!state.items.length){const hint=document.createElement('span');hint.className='dw2-lt-hint';hint.textContent='拖入悬浮球';tray.append(hint)}tray.hidden=!open;position()}
function sync(){if(!root)return;if(state.visible===false){restoreAll();root.style.display='none';return}root.style.display=state.minimized?'none':'';for(const el of [...hidden.keys()])if(!state.items.some(i=>resolve(i)===el))show(el);for(const item of state.items){const el=resolve(item);if(valid(el))hide(el)}render()}
function collect(el,clicked){if(!candidate(el))return false;const target=clicked&&el.contains(clicked)?clicked:el;el=outerCandidate(el);const s=selector(el);if(!s||state.items.some(i=>i.selector===s))return false;const text=(el.getAttribute('aria-label')||el.title||el.textContent||'').trim();state.items.push({selector:s,clickSelector:selector(target),name:text.slice(0,28)||'悬浮球',glyph:(text.replace(/\s/g,'').slice(0,2)||'◦')});hide(el);save();render();ball.classList.add('dw2-lt-pulse');setTimeout(()=>ball?.classList.remove('dw2-lt-pulse'),400);return true}
function candidates(){const all=document.querySelectorAll('[data-tt-mobile-surface="free-window"],[style*="fixed"],[style*="absolute"],button,img,iframe,[role="button"]');const out=[];for(const el of all){if(candidate(el))out.push(el)}return out}
function closestCandidate(el){for(let n=el;n&&n!==document.body;n=n.parentElement)if(candidate(n))return n;return null}
function pointInDock(x,y){const r=rect(ball);return x>=r.left-30&&x<=r.right+30&&y>=r.top-30&&y<=r.bottom+30}
function globalDown(e){if(state.visible===false||state.minimized||!root||root.contains(e.target))return;let el=closestCandidate(e.target);if(!el){let n=e.target;while(n&&n!==document.body){const s=getComputedStyle(n),r=rect(n);if(r.width>=22&&r.width<=125&&r.height>=22&&r.height<=125&&n.closest('[data-tt-mobile-surface="free-window"]')){el=n;break}n=n.parentElement}}if(!el){drag={el:e.target,target:e.target,x:e.clientX,y:e.clientY,moved:false,fallback:true,pointerId:e.pointerId};return}drag={el,target:e.target,x:e.clientX,y:e.clientY,moved:false,pointerId:e.pointerId};}
function globalMove(e){if(state.visible===false||state.minimized||!root)return;if(!drag||(drag.pointerId!=null&&e.pointerId!==drag.pointerId))return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>18){drag.moved=true;if(open){open=false;tray.hidden=true;position()}}ball.classList.toggle('dw2-lt-ready',drag.moved&&pointInDock(e.clientX,e.clientY))}
function globalUp(e){if(state.visible===false||state.minimized||!root){drag=null;ball?.classList.remove('dw2-lt-ready');return}if(!drag||(drag.pointerId!=null&&e.pointerId!==drag.pointerId))return;const d=drag;drag=null;ball.classList.remove('dw2-lt-ready');if(d.moved&&pointInDock(e.clientX,e.clientY)){const el=valid(d.el)?d.el:null;if(el){if(d.fallback){let n=el;while(n&&n!==document.body){if(candidate(n)){collect(n,d.target);break}n=n.parentElement}}else collect(el,d.target)}}}
function position(){if(!root)return;const side=state.side==='left'?'left':'right';root.dataset.side=side;root.classList.toggle('dw2-lt-open',open);root.style.left=side==='left'?'0px':'auto';root.style.right=side==='right'?'0px':'auto';const bottom=Math.max(12,Math.min(innerHeight-58,state.y));root.style.bottom=bottom+'px';if(tray){const gap=16,handle=60,margin=12;const above=Math.max(0,innerHeight-bottom-handle-gap-margin),below=Math.max(0,bottom-gap-margin);const desired=Math.min(310,28+(state.items.length+1)*40+state.items.length*13+(state.items.length?0:36));const direction=below>=desired||below>above?'down':'up';root.dataset.expand=direction;tray.style.maxHeight=Math.max(0,Math.min(310,direction==='down'?below:above))+'px'}root.style.transform=open?'translateX(0)':side==='left'?'translateX(-48%)':'translateX(48%)'}
function snap(x){state.side=x<innerWidth/2?'left':'right';state.x=0;state.y=Math.max(12,Math.min(innerHeight-52,state.y));save();position()}
function setVisible(yes){state.visible=yes;if(!yes){drag=null;ball?.classList.remove('dw2-lt-ready')}save();if(!yes){open=false;position();restoreAll();root.style.display='none'}else{sync()}updateMagicMenu()}
function setMinimized(yes){state.minimized=!!yes;if(state.minimized){drag=null;ball?.classList.remove('dw2-lt-ready')}open=false;save();if(root){tray.hidden=true;position();root.style.display=state.minimized||state.visible===false?'none':''}updateMagicMenu()}
function updateMagicMenu(){const item=document.getElementById('dw2-lt-magic-entry');if(!item)return;const off=state.minimized||state.visible===false;const label=item.querySelector('.dw2-lt-magic-label');if(label)label.textContent=off?'显示收纳框':'隐藏收纳框';item.setAttribute('aria-label',off?'显示收纳框':'隐藏收纳框')}
function mountBgMagicMenu(menu){
 let item=document.getElementById('dw2-lt-bg-magic-entry');
 if(item&&item.parentElement===menu)return;
 item?.remove();
 item=document.createElement('div');
 item.id='dw2-lt-bg-magic-entry';
 item.className='extension_container interactable';
 item.setAttribute('role','button');
 item.setAttribute('tabindex','0');
 item.setAttribute('aria-label','背景调节');
 const icon=document.createElement('i');icon.className='fa-solid fa-sliders';icon.setAttribute('aria-hidden','true');
 const label=document.createElement('span');label.className='dw2-lt-magic-label';label.textContent='背景调节';
 item.append(icon,label);
 const openPanel=e=>{e?.preventDefault();e?.stopPropagation();background.open()};
 item.addEventListener('click',openPanel);
 item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){openPanel(e)}});
 menu.append(item);
}

// Native magic-wand entry: floor hiding is prompt-context control, NOT visual
// deletion/folding of chat bubbles. Run only TT's own registered slash commands.
let floorPanel=null;
function parseFloorRange(raw,maxIndex){
 const match=/^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(raw??'').trim());
 if(!match)return {error:'请输入单个楼层号或连续范围，例如 12 或 0-10。'};
 const start=Number(match[1]),end=match[2]===undefined?start:Number(match[2]);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end)
  return {error:'楼层范围不正确。起点不能大于终点。'};
 if(!Number.isSafeInteger(maxIndex)||maxIndex<0)
  return {error:'当前没有可操作的聊天楼层。'};
 if(end>maxIndex)
  return {error:'楼层超出当前聊天范围（0-'+maxIndex+'）。'};
 return {start,end,range:start===end?String(start):start+'-'+end};
}
function closeFloorPanel(){
 floorPanel?.remove();
 floorPanel=null;
}

// Automated floor retention is opt-in. It changes only TT's own prompt context
// exclusion flag via /hide, not the chat content or on-screen messages.
let autoFloorTimer=0,autoFloorRunning=false,autoFloorGeneration=false,autoFloorEvents=[];
const AUTO_FLOOR_MARK='dw2LittleThingsAutoHidden';
function currentFloorKeep(){
 return state.autoFloorMode==='custom'?state.autoFloorCustom:50;
}
function autoFloorChatKey(ctx){
 const id=String(ctx?.getCurrentChatId?.()||ctx?.chatId||'');
 const participant=ctx?.groupId?('group:'+ctx.groupId):('character:'+ctx?.characterId);
 return id&&participant!=='character:undefined'&&participant!=='character:null'?participant+'/'+id:'';
}
function isAutoFloorOwned(message){
 return message?.extra?.[AUTO_FLOOR_MARK]===true;
}
function protectedFloorMessage(message,index){
 if(index===0||!message||message.is_system===true)return true;
 const body=String(message.mes||'');
 return /<abstract(?:\s[^>]*)?>|[✦☆]\s*大总结|大总结\s*第\s*\d+|总结范围[：:]/iu.test(body);
}
function collectFloorRanges(chat,start,end,eligible){
 const ranges=[];let first=-1;
 for(let i=start;i<end;i++){
  const yes=eligible(chat[i],i);
  if(yes&&first<0)first=i;
  if(!yes&&first>=0){ranges.push({start:first,end:i-1});first=-1;}
 }
 if(first>=0)ranges.push({start:first,end:end-1});
 return ranges;
}
function planAutoFloorRanges(chat,keep){
 if(!Array.isArray(chat)||!Number.isSafeInteger(keep)||keep<10)return [];
 const boundary=chat.length-keep;
 if(boundary<=1)return [];
 return collectFloorRanges(chat,1,boundary,(message,i)=>!protectedFloorMessage(message,i));
}
function inspectAutoFloorWindow(chat,keep){
 if(!Array.isArray(chat)||!Number.isSafeInteger(keep)||keep<10)return null;
 const first=Math.max(1,chat.length-keep),last=chat.length-1;
 const owned=[],untracked=[];
 for(let i=first;i<chat.length;i++){
  if(chat[i]?.is_system!==true)continue;
  (isAutoFloorOwned(chat[i])?owned:untracked).push(i);
 }
 return {total:chat.length,first,last,owned,untracked};
}
function planAutoFloorRestoreRanges(chat,keep){
 if(!Array.isArray(chat)||!Number.isSafeInteger(keep)||keep<10)return [];
 const boundary=Math.max(1,chat.length-keep);
 return collectFloorRanges(chat,boundary,chat.length,
  message=>message?.is_system===true&&isAutoFloorOwned(message));
}
// Ownership follows message.extra, not the ordinal position in the chat list.
// TT's native /hide and /unhide call saveChatConditional; make the marker change
// BEFORE the native command so it is saved with that same chat write.
function changeAutoFloorOwnership(messages,owned){
 const changed=[];
 for(const message of messages){
  if(!message||typeof message!=='object')continue;
  const existing=message.extra&&typeof message.extra==='object'?message.extra:null;
  const hadExtra=!!existing;
  const extra=existing||(owned?(message.extra={}):null);
  if(!extra)continue;
  const hadFlag=Object.prototype.hasOwnProperty.call(extra,AUTO_FLOOR_MARK);
  const previous=extra[AUTO_FLOOR_MARK];
  if(owned){
   if(message.is_system===true)continue;
   extra[AUTO_FLOOR_MARK]=true;
  }else{
   if(!hadFlag)continue;
   delete extra[AUTO_FLOOR_MARK];
  }
  changed.push({message,extra,hadExtra,hadFlag,previous});
 }
 return ()=>{
  for(const {message,extra,hadExtra,hadFlag,previous} of changed){
   if(message.extra!==extra)continue;
   if(hadFlag)extra[AUTO_FLOOR_MARK]=previous;
   else delete extra[AUTO_FLOOR_MARK];
   if(!hadExtra&&!Object.keys(extra).length)delete message.extra;
  }
 };
}
function scheduleAutoFloor(ms=800){
 clearTimeout(autoFloorTimer);
 autoFloorTimer=0;
 if(!state.floorEnabled||!state.autoFloorEnabled)return;
 autoFloorTimer=setTimeout(()=>{autoFloorTimer=0;void runAutoFloor();},ms);
}
async function runAutoFloor(){
 if(!state.floorEnabled||!state.autoFloorEnabled||autoFloorGeneration)return;
 if(autoFloorRunning){scheduleAutoFloor(1300);return;}
 const ctx=globalThis.SillyTavern?.getContext?.();
 const key=autoFloorChatKey(ctx);
 if(!key||!Array.isArray(ctx?.chat)||!ctx.chat.length)return;
 const originalChat=ctx.chat;
 const plannedLength=originalChat.length;
 // Reconcile first: deletion, swipe replacement or a larger retention window
 // can bring already auto-hidden messages back into the visible context window.
 const restore=planAutoFloorRestoreRanges(originalChat,currentFloorKeep())
  .map(range=>({ ...range,action:'unhide' }));
 const hide=planAutoFloorRanges(originalChat,currentFloorKeep())
  .map(range=>({ ...range,action:'hide' }));
 const operations=[...restore,...hide];
 if(!operations.length)return;
 if(typeof ctx.executeSlashCommandsWithOptions!=='function')return;
 autoFloorRunning=true;
 try{
  const maxPerPass=12;
  for(const operation of operations.slice(0,maxPerPass)){
   if(!state.floorEnabled||!state.autoFloorEnabled||autoFloorGeneration)break;
   const live=globalThis.SillyTavern?.getContext?.();
   if(live?.chat!==originalChat||autoFloorChatKey(live)!==key)break;
   if(originalChat.length!==plannedLength){scheduleAutoFloor(900);break;}
   const messages=originalChat.slice(operation.start,operation.end+1);
   if(messages.length!==operation.end-operation.start+1||
      messages.some((message,i)=>!message||originalChat[operation.start+i]!==message))break;
   // Another listener might have changed the chat while this task was queued.
   if(operation.action==='unhide'&&messages.some(m=>!isAutoFloorOwned(m)||m.is_system!==true))continue;
   if(operation.action==='hide'&&messages.some(m=>m.is_system===true))continue;
   const undo=changeAutoFloorOwnership(messages,operation.action==='hide');
   const cmd='/'+operation.action+' '+(operation.start===operation.end?operation.start:operation.start+'-'+operation.end);
   try{
    const result=await live.executeSlashCommandsWithOptions(cmd,{
     handleParserErrors:false,handleExecutionErrors:false,source:'dw2-little-things-auto-floor'
    });
    const expected=operation.action==='hide';
    if(!result||result.isAborted||messages.some(m=>m.is_system!==expected))
     throw new Error('TT 未能确认自动楼层操作完成');
   }catch(error){undo();throw error;}
  }
  if(state.floorEnabled&&state.autoFloorEnabled&&(operations.length>maxPerPass||originalChat.length!==plannedLength))scheduleAutoFloor(1400);
 }catch(err){
  console.warn('[DW2 Little Things] Auto floor adjustment stopped:',err);
  state.autoFloorEnabled=false;save();
  notify('自动隐藏/回补已暂停：'+String(err?.message||err),'warning');
 }finally{autoFloorRunning=false;}
}
function bindAutoFloorEvents(){
 if(!state.floorEnabled||autoFloorEvents.length)return;
 const ctx=globalThis.SillyTavern?.getContext?.();
 const bus=ctx?.eventSource,types=ctx?.eventTypes||ctx?.event_types;
 if(!bus?.on||!types)return;
 for(const [name,listener] of [
  ['CHAT_CHANGED',()=>{autoFloorGeneration=false;scheduleAutoFloor(1100);}],
  ['GENERATION_STARTED',()=>{autoFloorGeneration=true;}],
  ['GENERATION_ENDED',()=>{autoFloorGeneration=false;scheduleAutoFloor(1100);}],
  ['GENERATION_STOPPED',()=>{autoFloorGeneration=false;scheduleAutoFloor(1100);} ],
  ['MESSAGE_RECEIVED',()=>scheduleAutoFloor(1300)],
  ['MESSAGE_DELETED',()=>scheduleAutoFloor(1100)]
 ]){
  const type=types[name];if(!type)continue;
  bus.on(type,listener);autoFloorEvents.push({bus,type,listener});
 }
 scheduleAutoFloor(1600);
}
function unbindAutoFloorEvents(){
 clearTimeout(autoFloorTimer);autoFloorTimer=0;
 for(const {bus,type,listener} of autoFloorEvents.splice(0)){
  if(typeof bus.off==='function')bus.off(type,listener);
  else if(typeof bus.removeListener==='function')bus.removeListener(type,listener);
 }
 autoFloorGeneration=false;
}

function openFloorPanel(){
 if(!state.floorEnabled)return;
 closeFloorPanel();
 const ctx=globalThis.SillyTavern?.getContext?.();
 // Settings can be configured even before entering a chat.
 // Manual execution still validates actual chat range on submit.
 const overlay=document.createElement('div');
 overlay.id='dw2-lt-floor-backdrop';
 overlay.setAttribute('role','presentation');
 const dialog=document.createElement('section');
 dialog.id='dw2-lt-floor-panel';
 dialog.setAttribute('role','dialog');
 dialog.setAttribute('aria-modal','true');
 dialog.setAttribute('aria-label','楼层操作台');
 const head=document.createElement('div');head.className='dw2-lt-floor-head';
 const title=document.createElement('div');title.className='dw2-lt-floor-title';
 title.textContent='🪐 楼层操作台';
 const close=document.createElement('button');close.type='button';close.className='dw2-lt-floor-close';
 close.textContent='×';close.setAttribute('aria-label','关闭楼层操作台');
 close.onclick=closeFloorPanel;head.append(title,close);
 const intro=document.createElement('p');intro.className='dw2-lt-floor-intro';
 intro.textContent='仅调整发送给 AI 的上下文，不删除消息，也不隐藏聊天页面上的楼层。';
 const options=document.createElement('div');options.className='dw2-lt-floor-options';
 const hide=document.createElement('button'),restore=document.createElement('button');
 for(const [button,label] of [[hide,'🌙 隐藏楼层'],[restore,'💫 恢复楼层']]){
  button.type='button';button.className='dw2-lt-floor-mode';button.textContent=label;options.append(button);
 }
 const caption=document.createElement('label');caption.className='dw2-lt-floor-label';
 caption.htmlFor='dw2-lt-floor-input';caption.textContent='楼层号或范围';
 const input=document.createElement('input');input.id='dw2-lt-floor-input';
 input.type='text';input.inputMode='text';input.autocomplete='off';input.spellcheck=false;
 input.placeholder='例如 0-10 或 12';input.setAttribute('aria-label','请输入楼层范围');
 const rangeHint=document.createElement('p');rangeHint.className='dw2-lt-floor-hint';
 rangeHint.textContent=ctx?.chat?.length?'当前可用楼层：0-'+(ctx.chat.length-1):'尚未进入有效聊天；可先设置自动模式。';
 const error=document.createElement('p');error.className='dw2-lt-floor-error';
 error.setAttribute('role','status');error.setAttribute('aria-live','polite');
 const actions=document.createElement('div');actions.className='dw2-lt-floor-actions';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='取消';
 cancel.onclick=closeFloorPanel;
 const submit=document.createElement('button');submit.type='button';
 submit.className='dw2-lt-floor-submit';
 let mode='hide',busy=false;
 function choose(next){
  mode=next;hide.setAttribute('aria-pressed',String(mode==='hide'));
  restore.setAttribute('aria-pressed',String(mode==='unhide'));
  submit.textContent=mode==='hide'?'确认隐藏':'确认恢复';
  error.textContent='';
 }
 hide.onclick=()=>choose('hide');restore.onclick=()=>choose('unhide');
 choose('hide');
 async function apply(){
  if(busy)return;
  const live=globalThis.SillyTavern?.getContext?.();
  const parsed=parseFloorRange(input.value,(live?.chat?.length??0)-1);
  if(parsed.error){error.textContent=parsed.error;return;}
  const execute=live?.executeSlashCommandsWithOptions;
  if(typeof execute!=='function'){
   error.textContent='当前 TT 未提供楼层操作接口，请检查版本。';return;
  }
  if(autoFloorRunning){error.textContent='自动楼层任务正在运行，请稍后再操作。';return;}
  busy=true;submit.disabled=true;cancel.disabled=true;close.disabled=true;submit.textContent='处理中…';error.textContent='';
  const manualTargets=live.chat.slice(parsed.start,parsed.end+1);
  // Explicit manual actions relinquish auto ownership. Leave native TT as the
  // only authority for whether a message is ultimately hidden.
  const undoManual=changeAutoFloorOwnership(manualTargets,false);
  try{
   const result=await execute('/'+mode+' '+parsed.range,{
    handleParserErrors:false,handleExecutionErrors:false,source:'dw2-little-things-floor'
   });
   if(!result||result.isAborted)throw new Error('楼层操作未完成');
   closeFloorPanel();
   notify((mode==='hide'?'已执行隐藏':'已执行恢复')+'楼层 '+parsed.range+'；可在 TT 聊天中确认效果。','success');
  }catch(ex){
   undoManual();
   error.textContent='操作失败：'+String(ex?.message||ex);
  }finally{
   busy=false;submit.disabled=false;cancel.disabled=false;close.disabled=false;
   if(floorPanel===overlay)submit.textContent=mode==='hide'?'确认隐藏':'确认恢复';
  }
 }
 submit.onclick=()=>void apply();
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void apply();}});
 actions.append(cancel,submit);
 // Auto controls are independent of the manual hide/restore form.
 const autoBox=document.createElement('section');autoBox.className='dw2-lt-floor-auto';
 const autoHead=document.createElement('label');autoHead.className='dw2-lt-floor-auto-head';
 const autoCheck=document.createElement('input');autoCheck.type='checkbox';
 autoCheck.id='dw2-lt-floor-auto-enabled';autoCheck.checked=state.autoFloorEnabled;
 const autoTitle=document.createElement('span');autoTitle.textContent='自动隐藏旧楼层';
 autoHead.append(autoCheck,autoTitle);
 const autoHint=document.createElement('p');autoHint.className='dw2-lt-floor-auto-hint';
 autoHint.textContent='保留开场白与带标记的大总结。删除或重新生成后，只回补由本功能隐藏的旧消息；手动恢复前请先关闭自动开关。';
 const keepOptions=document.createElement('div');keepOptions.className='dw2-lt-floor-keep-options';
 const keep50=document.createElement('button');keep50.type='button';keep50.textContent='保留最近 50 层';
 const keepCustom=document.createElement('button');keepCustom.type='button';keepCustom.textContent='自定义层数';
 keepOptions.append(keep50,keepCustom);
 const customWrap=document.createElement('label');customWrap.className='dw2-lt-floor-custom-wrap';
 customWrap.textContent='自定义保留：';
 const customInput=document.createElement('input');customInput.type='number';customInput.min='10';
 customInput.max='5000';customInput.step='1';customInput.inputMode='numeric';
 customInput.value=String(state.autoFloorCustom);
 customInput.setAttribute('aria-label','自定义保留最近多少层');
 const unit=document.createElement('span');unit.textContent='层（10～5000）';
 customWrap.append(customInput,unit);
 const autoStatus=document.createElement('p');autoStatus.className='dw2-lt-floor-auto-status';
 autoStatus.setAttribute('role','status');autoStatus.setAttribute('aria-live','polite');
 function showAuto(){
  autoCheck.checked=state.autoFloorEnabled;
  keep50.setAttribute('aria-pressed',String(state.autoFloorMode==='50'));
  keepCustom.setAttribute('aria-pressed',String(state.autoFloorMode==='custom'));
  customWrap.hidden=state.autoFloorMode!=='custom';
  autoStatus.textContent=(state.autoFloorEnabled?'已启用':'已关闭')+' · 保留最近 '+currentFloorKeep()+' 层。关闭不自动恢复历史消息。';
 }
 function setKeep(choice){
  if(choice==='custom'){
   const val=Number(customInput.value);
   if(!Number.isSafeInteger(val)||val<10||val>5000){
    autoStatus.textContent='请填写 10～5000 之间的整数。';
    return;
   }
   state.autoFloorCustom=val;
  }
  state.autoFloorMode=choice;save();showAuto();scheduleAutoFloor(450);
 }
 keep50.onclick=()=>setKeep('50');
 keepCustom.onclick=()=>setKeep('custom');
 customInput.onchange=()=>{
  if(state.autoFloorMode!=='custom')return;
  setKeep('custom');
 };
 autoCheck.onchange=()=>{
  if(autoCheck.checked&&state.autoFloorMode==='custom'){
   const val=Number(customInput.value);
   if(!Number.isSafeInteger(val)||val<10||val>5000){
    autoCheck.checked=false;autoStatus.textContent='先设置 10～5000 之间的保留层数。';return;
   }
   state.autoFloorCustom=val;
  }
  state.autoFloorEnabled=autoCheck.checked;
  save();showAuto();
  if(state.autoFloorEnabled)scheduleAutoFloor(400);
  else{clearTimeout(autoFloorTimer);autoFloorTimer=0;}
 };
 showAuto();
 const inspector=document.createElement('div');inspector.className='dw2-lt-floor-inspector';
 const inspectorBtn=document.createElement('button');inspectorBtn.type='button';
 inspectorBtn.className='dw2-lt-floor-inspect-btn';
 inspectorBtn.textContent='检查当前聊天的保留范围';
 const inspectorResult=document.createElement('p');
 inspectorResult.className='dw2-lt-floor-inspector-result';
 inspectorResult.setAttribute('aria-live','polite');
 function checkCurrentWindow(){
  const snapshot=globalThis.SillyTavern?.getContext?.();
  const report=inspectAutoFloorWindow(snapshot?.chat,currentFloorKeep());
  if(!report||!report.total){
   inspectorResult.textContent='请先打开一份有记录的聊天。';
   return;
  }
  const {total,first,last,owned,untracked}=report;
  const protectedRange=first<=last?first+'～'+last:'无';
  const list=xs=>xs.length>16?xs.slice(0,16).join('、')+' 等 '+xs.length+' 层':xs.join('、');
  let message='当前 '+total+' 条消息（0～'+last+'）；最新 '+currentFloorKeep()+' 层应保留：'+protectedRange+'。\n';
  message+='范围内新版自动隐藏未回补：'+owned.length+' 条'+(owned.length?'（'+list(owned)+'）':'')+'。\n';
  message+='范围内无归属标记的隐藏：'+untracked.length+' 条'+(untracked.length?'（'+list(untracked)+'）':'')+'。';
  if(untracked.length)message+='\n这些可能是旧版残留，也可能是手动隐藏。请核对后用下方「💫 恢复楼层」处理；插件不会私自恢复。';
  else if(owned.length)message+='\n如已开启自动隐藏，请等一秒再检查；持续未恢复可尝试切换聊天后重新检查。';
  else message+='\n当前保留范围内没有异常隐藏。';
  inspectorResult.textContent=message;
 }
 inspectorBtn.onclick=checkCurrentWindow;
 inspector.append(inspectorBtn,inspectorResult);
 autoBox.append(autoHead,autoHint,keepOptions,customWrap,autoStatus,inspector);
 dialog.append(head,intro,autoBox,options,caption,input,rangeHint,error,actions);
 overlay.append(dialog);
 overlay.addEventListener('click',e=>{if(e.target===overlay&&!busy)closeFloorPanel();});
 overlay.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!busy){e.stopPropagation();closeFloorPanel();}
 });
 document.body.append(overlay);floorPanel=overlay;
}
function mountFloorMagicMenu(menu){
 let item=document.getElementById('dw2-lt-floor-magic-entry');
 if(item&&item.parentElement===menu)return;
 item?.remove();
 item=document.createElement('div');
 item.id='dw2-lt-floor-magic-entry';item.className='extension_container interactable';
 item.setAttribute('role','button');item.setAttribute('tabindex','0');
 item.setAttribute('aria-label','楼层操作');
 const icon=document.createElement('i');icon.className='fa-solid fa-layer-group';
 icon.setAttribute('aria-hidden','true');
 const label=document.createElement('span');label.className='dw2-lt-magic-label';
 label.textContent='楼层操作';
 item.append(icon,label);
 const open=e=>{e?.preventDefault();e?.stopPropagation();openFloorPanel();};
 item.addEventListener('click',open);
 item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){open(e);}});
 menu.append(item);
}

function mountMagicMenu(){
 const menu=document.querySelector('#extensionsMenu');if(!menu)return;
 let item=document.getElementById('dw2-lt-magic-entry');
 if(!state.floatEnabled)item?.remove();
 else {
  if(item?.parentElement!==menu){
   item?.remove();item=document.createElement('div');
   item.id='dw2-lt-magic-entry';
   item.className='extension_container interactable';
   item.setAttribute('role','button');item.setAttribute('tabindex','0');
   const icon=document.createElement('i');icon.className='fa-solid fa-bookmark';
   icon.setAttribute('aria-hidden','true');
   const label=document.createElement('span');label.className='dw2-lt-magic-label';
   item.append(icon,label);
   const toggle=e=>{
    e?.preventDefault();e?.stopPropagation();
    if(state.visible===false){setVisible(true);setMinimized(false);}
    else setMinimized(!state.minimized);
   };
   item.addEventListener('click',toggle);
   item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){toggle(e)}});
   menu.append(item);
  }
  updateMagicMenu();
 }
 // The background-tuner menu is independent of the floating collection.
 mountBgMagicMenu(menu);
 if(state.floorEnabled)mountFloorMagicMenu(menu);
 else document.getElementById('dw2-lt-floor-magic-entry')?.remove();
}
function sortSettings(){const section=document.getElementById('dw2-lt-settings');const anchor=document.getElementById('dw2-preset-console-settings');if(!section||!anchor||!anchor.parentElement||anchor===section)return;const host=anchor.parentElement;if(section.parentElement!==host||anchor.nextElementSibling!==section)anchor.after(section)}
function notify(message,kind='info'){const t=window.toastr;if(typeof t?.[kind]==='function')t[kind](message,'DW2 · Little Things');else window.alert(message)}
async function updateLittleThings(btn){if(btn.disabled)return;btn.disabled=true;btn.textContent='检查中…';try{const [scriptMod,extMod]=await Promise.all([import('/script.js'),import('/scripts/extensions.js')]);const headers=typeof scriptMod.getRequestHeaders==='function'?scriptMod.getRequestHeaders():{'Content-Type':'application/json'};const types=extMod.extensionTypes||{};const id=Object.keys(types).find(key=>key==='third-party/dw2-little-things'||key==='dw2-little-things'||key.endsWith('/dw2-little-things'));if(!id)throw new Error('无法识别插件安装目录，请使用管理扩展更新');const res=await fetch('/api/extensions/update',{method:'POST',headers,body:JSON.stringify({extensionName:id.replace(/^third-party\//,''),global:types[id]==='global'})});if(!res.ok)throw new Error((await res.text()).slice(0,220)||'HTTP '+res.status);const result=await res.json();notify(result.isUpToDate?'已是最新版本':'更新完成，请刷新酒馆','success')}catch(error){notify('检查更新失败：'+(error.message||error)+'。也可在管理扩展中更新。','warning')}finally{btn.disabled=false;btn.textContent='检查并更新'}}
function mountSettings(){
 let section=document.getElementById('dw2-lt-settings');
 if(section){sortSettings();return}
 const host=document.querySelector('#extensions_settings2,#extensions_settings,.extensions_settings');
 if(!host)return;
 section=document.createElement('div');section.id='dw2-lt-settings';section.className='inline-drawer';
 const header=document.createElement('div');header.className='inline-drawer-toggle inline-drawer-header';
 header.setAttribute('aria-expanded','false');
 const title=document.createElement('div');title.className='dw2-lt-heading';
 const headingTitle=document.createElement('b');headingTitle.className='dw2-lt-title';headingTitle.textContent='✧ DW2 · Little Things';
 const credit=document.createElement('span');credit.className='dw2-lt-credit';credit.textContent='S.A. · DW2';
 title.append(headingTitle,credit);
 const arrow=document.createElement('i');arrow.className='inline-drawer-icon fa-solid fa-circle-chevron-down down';
 header.append(title,arrow);
 const body=document.createElement('div');body.className='inline-drawer-content';body.style.display='none';
 const versionNote=document.createElement('p');versionNote.className='dw2-lt-version-note';
 versionNote.textContent='独立模块开关 · 悬浮收纳 · 背景调节 · 楼层操作 · v0.7.3-beta.1';
 const floatBox=document.createElement('div');floatBox.className='dw2-lt-module-box';
 const floatRow=document.createElement('label');floatRow.className='dw2-lt-switch';
 const floatCheck=document.createElement('input');floatCheck.type='checkbox';
 floatCheck.id='dw2-lt-float-enabled';floatCheck.checked=state.floatEnabled;
 floatCheck.onchange=()=>setFloatEnabled(floatCheck.checked);
 floatRow.append(floatCheck,document.createTextNode(' 启用悬浮收纳（关闭即停止监听）'));
 const floatHint=document.createElement('p');floatHint.className='dw2-lt-version-note';
 floatHint.textContent='关闭后释放悬浮球与收纳监听，已保存的收纳列表仍保留。';
 const reset=document.createElement('button');reset.type='button';
 reset.className='dw2-lt-recover-btn';reset.textContent='恢复全部悬浮球';
 reset.onclick=()=>{state.items=[];restoreAll();save();render()};
 floatBox.append(floatRow,floatHint,reset);
 const bgBox=document.createElement('div');bgBox.className='dw2-lt-module-box';
 const bgRow=document.createElement('label');bgRow.className='dw2-lt-switch';
 const bgCheck=document.createElement('input');bgCheck.type='checkbox';
 bgCheck.id='dw2-lt-bg-enabled';bgCheck.checked=!!state.bgTunerEnabled;
 bgCheck.onchange=()=>{if(bgCheck.checked)background.enable();else background.disable()};
 bgRow.append(bgCheck,document.createTextNode(' 启用背景调节'));
 const bgOpen=document.createElement('button');bgOpen.type='button';
 bgOpen.className='dw2-lt-bg-open';bgOpen.textContent='打开背景调节';
 bgOpen.onclick=()=>background.open();
 bgBox.append(bgRow,bgOpen);
 const floorBox=document.createElement('div');floorBox.className='dw2-lt-module-box';
 const floorRow=document.createElement('label');floorRow.className='dw2-lt-switch';
 const floorCheck=document.createElement('input');floorCheck.type='checkbox';
 floorCheck.id='dw2-lt-floor-enabled';floorCheck.checked=state.floorEnabled;
 floorCheck.onchange=()=>setFloorEnabled(floorCheck.checked);
 floorRow.append(floorCheck,document.createTextNode(' 启用楼层操作（独立监听）'));
 const floorHint=document.createElement('p');floorHint.className='dw2-lt-version-note';
 floorHint.textContent='关闭后停止自动楼层事件监听，不更改已隐藏的聊天记录。';
 floorBox.append(floorRow,floorHint);
 const actions=document.createElement('div');actions.className='dw2-lt-actions';
 const update=document.createElement('button');update.textContent='检查并更新';update.onclick=()=>void updateLittleThings(update);
 const refresh=document.createElement('button');refresh.textContent='刷新酒馆';
 refresh.onclick=()=>{if(window.confirm('重新加载 TT 酒馆？请先保存尚未保存的修改。'))window.location.reload()};
 actions.append(update,refresh);
 body.append(versionNote,floatBox,bgBox,floorBox,actions);
 header.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const expanded=body.style.display==='none';body.style.display=expanded?'block':'none';header.setAttribute('aria-expanded',String(expanded));arrow.classList.toggle('down',!expanded)});
 section.append(header,body);host.append(section);sortSettings();
}
let uiSyncTimer=0;
function startFloat(){
 if(root)return;
 root=document.createElement('div');root.id=ID;root.dataset.ttMobileSurface='free-window';
 ball=document.createElement('button');ball.id='dw2-lt-btn';ball.textContent='little';
 ball.setAttribute('aria-label','悬浮收纳');
 tray=document.createElement('div');tray.id='dw2-lt-tray';tray.hidden=true;
 root.append(tray,ball);document.body.append(root);
 if(!state.side)state.side=state.x>innerWidth/2?'left':'right';
 position();
 let start=null,moved=false;
 ball.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY,ry:state.y};moved=false;try{ball.setPointerCapture(e.pointerId)}catch{}});
 ball.addEventListener('pointermove',e=>{if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)>7)moved=true;if(moved){state.y=Math.max(12,Math.min(innerHeight-52,start.ry-dy));root.style.transform='translateX(0)';root.style.left=Math.max(0,Math.min(innerWidth-28,e.clientX-14))+'px';root.style.right='auto';root.dataset.dragging='true';root.style.bottom=state.y+'px'}});
 ball.addEventListener('pointerup',e=>{start=null;root.removeAttribute('data-dragging');if(moved)snap(e.clientX);else position()});
 ball.addEventListener('pointercancel',()=>{start=null;root.removeAttribute('data-dragging');position()});
 ball.onclick=()=>{if(moved){moved=false;return}open=!open;render()};
 floatResizeHandler=()=>position();
 window.addEventListener('resize',floatResizeHandler);
 document.addEventListener('pointerdown',globalDown,true);
 document.addEventListener('pointermove',globalMove,true);
 document.addEventListener('pointerup',globalUp,true);
 document.addEventListener('pointercancel',globalUp,true);
 // Only the floating-collection module owns this broad observer.
 observer=new MutationObserver(()=>{
  clearTimeout(scanTimer);
  scanTimer=setTimeout(()=>{
   scanTimer=0;
   if(!state.floatEnabled||!root)return;
   for(const i of state.items){const el=resolve(i);if(valid(el))hide(el)}
  },150);
 });
 observer.observe(document.body,{childList:true,subtree:true});
 sync();
}
let floatResizeHandler=null;
function stopFloat(){
 observer?.disconnect();observer=null;
 clearTimeout(scanTimer);scanTimer=0;
 if(floatResizeHandler)window.removeEventListener('resize',floatResizeHandler);
 floatResizeHandler=null;
 document.removeEventListener('pointerdown',globalDown,true);
 document.removeEventListener('pointermove',globalMove,true);
 document.removeEventListener('pointerup',globalUp,true);
 document.removeEventListener('pointercancel',globalUp,true);
 restoreAll();
 root?.remove();root=null;ball=null;tray=null;
 drag=null;open=false;
}
function setFloatEnabled(yes){
 const enabled=!!yes;
 if(enabled===state.floatEnabled)return;
 state.floatEnabled=enabled;
 if(enabled){state.visible=true;state.minimized=false;startFloat();}
 else stopFloat();
 save();
 const checkbox=document.getElementById('dw2-lt-float-enabled');
 if(checkbox)checkbox.checked=enabled;
 mountMagicMenu();
}
function setFloorEnabled(yes){
 const enabled=!!yes;
 if(enabled===state.floorEnabled)return;
 state.floorEnabled=enabled;save();
 if(enabled)bindAutoFloorEvents();
 else{unbindAutoFloorEvents();closeFloorPanel();}
 const checkbox=document.getElementById('dw2-lt-floor-enabled');
 if(checkbox)checkbox.checked=enabled;
 mountMagicMenu();
}
function mount(){
 mountSettings();mountMagicMenu();
 background.init();
 if(state.floorEnabled)bindAutoFloorEvents();
 if(state.floatEnabled)startFloat();
 // Small menu/settings check: unlike the floating collector it does not scan chat DOM.
 if(!uiSyncTimer)uiSyncTimer=setInterval(()=>{mountSettings();mountMagicMenu()},3000);
}
function unmount(){
 if(uiSyncTimer)clearInterval(uiSyncTimer);uiSyncTimer=0;
 stopFloat();unbindAutoFloorEvents();closeFloorPanel();background.stop();
 document.getElementById('dw2-lt-magic-entry')?.remove();
 document.getElementById('dw2-lt-bg-magic-entry')?.remove();
 document.getElementById('dw2-lt-floor-magic-entry')?.remove();
 document.getElementById('dw2-lt-settings')?.remove();
}
window.DW2LittleThings={
 enable:mount,disable:unmount,
 detect:()=>candidates().map(el=>({selector:selector(el),rect:rect(el).toJSON?.()})),
 restore:()=>{state.items=[];restoreAll();save();render()},
 setFloatingEnabled:setFloatEnabled,
 setFloorEnabled:setFloorEnabled
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();