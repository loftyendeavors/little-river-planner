import { parseDocument } from 'htmlparser2';

export const LINK_LIMITS=Object.freeze({html:3*1024*1024,image:8*1024*1024,redirects:4,timeout:20000,text:48000,nodes:100000});
export class LinkError extends Error{constructor(message,status=422){super(message);this.status=status;}}
const fail=(message,status)=>{throw new LinkError(message,status);};
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
export function publicURL(value){
 let u;try{u=new URL(String(value));}catch{fail('Paste a complete HTTPS product URL.',400);}
 const h=u.hostname.toLowerCase().replace(/\.$/,'');
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.href.length>4096||!h.includes('.')||/[:\[\]]/.test(h)||/^[\d.]+$/.test(h)||/(?:^|\.)(?:localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(h)||h==='metadata.google.internal'||!/^[a-z0-9.-]+$/.test(h))fail('Use a public HTTPS supplier product page.',400);
 u.hash='';return u;
}
function publicIP(raw){
 const s=String(raw).toLowerCase();
 if(s.includes(':'))return /^[0-9a-f:]+$/.test(s)&&/^[23]/.test(s)&&!s.startsWith('2002:')&&!s.startsWith('3fff:')&&!s.startsWith('::')&&!s.startsWith('fc')&&!s.startsWith('fd')&&!s.startsWith('fe')&&!s.startsWith('ff')&&!s.startsWith('2001:db8')&&!s.startsWith('2001:0:')&&!s.startsWith('64:ff9b');
 const a=s.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&a[0]>0&&a[0]!==10&&a[0]!==127&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&(a[1]===168||a[1]===0&&(a[2]===0||a[2]===2)))&&!(a[0]===100&&a[1]>=64&&a[1]<=127)&&!(a[0]===198&&(a[1]===18||a[1]===19||a[1]===51&&a[2]===100))&&!(a[0]===203&&a[1]===0&&a[2]===113);
}
async function resolvePublic(host,fetcher,signal){
 const answers=await Promise.all([1,28].map(async type=>{const response=await fetcher('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{accept:'application/dns-json'},signal,redirect:'manual',credentials:'omit'});if(!response.ok)fail('The supplier address could not be verified. Try again.');const data=await response.json();if(data.Status!==0)fail('The supplier address could not be resolved.');return data.Answer||[];}));
 const ips=answers.flat().filter(x=>x.type===1||x.type===28).map(x=>x.data);if(!ips.length||ips.some(ip=>!publicIP(ip)))fail('This link does not resolve to a public supplier address.',400);
}
async function limited(response,max){
 const declared=Number(response.headers.get('content-length')||0);if(declared>max)fail('The supplier response is too large to import.',413);
 const reader=response.body?.getReader();if(!reader)fail('The supplier returned an empty response.');const parts=[];let n=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>max)fail('The supplier response is too large to import.',413);parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 const bytes=new Uint8Array(n);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length;}return bytes;
}
export async function fetchPublic(value,{image=false,json=false,fetcher=fetch,resolver=resolvePublic}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),LINK_LIMITS.timeout);let u=publicURL(value);
 try{for(let hops=0;hops<=LINK_LIMITS.redirects;hops++){
  await resolver(u.hostname,fetcher,controller.signal);
  const r=await fetcher(u.href,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{accept:image?'image/jpeg,image/png,image/webp,image/gif':json?'application/json':'text/html,application/xhtml+xml','user-agent':'LittleRiverFarmProductReader/1.0'},signal:controller.signal});
  if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();const location=r.headers.get('location');if(!location||hops===LINK_LIMITS.redirects)fail('The supplier link redirects too many times. Paste its final product URL.');u=publicURL(new URL(location,u).href);continue;}
  if(!r.ok)fail(r.status===403||r.status===429?'This supplier blocked the reader. Copy its product details and use Read pasted details.':'The supplier page could not be read (HTTP '+r.status+').',r.status===404?404:422);
  const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(image?!['image/jpeg','image/png','image/webp','image/gif'].includes(mime):json?mime!=='application/json':!['text/html','application/xhtml+xml'].includes(mime))fail(image?'The chosen image is not a supported product photo.':json?'The supplier product data could not be read.':'This link is not an HTML product page. Use a supplier product link or paste its product details.');
  const bytes=await limited(r,image?LINK_LIMITS.image:LINK_LIMITS.html);
  if(image){const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':new TextDecoder().decode(bytes.slice(0,6)).match(/^GIF8[79]a$/);if(!valid)fail('The image content did not match its declared format.');}
  return {url:u.href,mime,bytes};
 }}catch(e){if(e instanceof LinkError)throw e;fail(controller.signal.aborted?'The supplier took too long to respond. Try again or paste its product text.':'The supplier could not be reached. Try again or paste its product text.');}finally{clearTimeout(timer);}
}
const children=n=>n?.children||[],attr=(n,key)=>n?.attribs?.[key]||'';
function nodes(root){const out=[],stack=[[root,0]];while(stack.length){const [n,depth]=stack.pop();if(depth>200)fail('This product page has too much nested markup to review.');out.push(n);if(out.length>LINK_LIMITS.nodes)fail('This product page has too much markup to review.');for(const c of children(n).slice().reverse())stack.push([c,depth+1]);}return out;}
const omitted=n=>['script','style','nav','header','footer','button','noscript','svg','template'].includes(n.name)||/recommend|related-product|recently-viewed|upsell|cross-sell|cookie|newsletter|mini-cart|c-dialog|tooltip/i.test(attr(n,'id')+' '+attr(n,'class'));
function text(n){if(n?.type==='text')return n.data||'';if(!n||omitted(n))return '';if(n.name==='br')return '\n';const content=children(n).map(text).join(['html','body','main','p','li','div','section','article','table','tr','dl','dt','dd','h1','h2','h3','h4','br'].includes(n.name)?'\n':' ');return content;}
function absolute(value,base){if(!clean(value))return '';try{return publicURL(new URL(String(value),base).href).href;}catch{return '';}}
export function canonical(value){const u=publicURL(value);for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|srsltid$|mc_)/i.test(key))u.searchParams.delete(key);return u.href;}
const normalize=s=>clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ');
function structured(all){
 const found=[];for(const n of all.filter(n=>n.name==='script'&&/ld\+json|application\/json/i.test(attr(n,'type')))){
  const raw=children(n).map(c=>c.data||'').join('');if(raw.length>600000)continue;let parsed;try{parsed=JSON.parse(raw);}catch{continue;}
  const visit=(v,depth=0)=>{if(depth>14||!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v.slice(0,200))visit(x,depth+1);return;}const types=[v['@type']].flat();if(types.some(t=>['Product','ProductGroup'].includes(t))||v.title&&Array.isArray(v.variants)&&(v.product_type||v.handle))found.push(v);for(const key of ['@graph','mainEntity','hasVariant','itemListElement','item','product'])visit(v[key],depth+1);};visit(parsed);
 }return found;
}
const unitInches=u=>/^(ft|feet|foot|'|′|’|‘)$/i.test(u)?12:/^(cm|centimeters?)$/i.test(u)?1/2.54:/^(mm|millimeters?)$/i.test(u)?1/25.4:1;
function number(s){const v=String(s).replace(/,/g,'').replace(/(\d)\s*([½¼¾⅛⅜⅝⅞])/g,(_,a,b)=>String(+a+({'½':.5,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875}[b]))).replace(/[½¼¾⅛⅜⅝⅞]/g,b=>String({'½':.5,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875}[b])).trim();if(v.includes('/')){const a=v.split('/').map(Number);return a.length===2&&a[1]>0?a[0]/a[1]:null;}const n=Number(v);return Number.isFinite(n)?n:null;}
const measurement='(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+|\\s*[½¼¾⅛⅜⅝⅞])?|[½¼¾⅛⅜⅝⅞])\\s*(?:(?:[-–—]|to)\\s*(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+|\\s*[½¼¾⅛⅜⅝⅞])?|[½¼¾⅛⅜⅝⅞]))?\\s*(inches?|in\\.?|["″“”]|ft|feet|foot|[\'′’‘]|cm|mm)(?![a-z])';
function measure(value){const m=String(value).match(new RegExp(measurement,'i'));if(!m)return null;const factor=unitInches(m[3]),min=number(m[1])*factor,max=number(m[2]||m[1])*factor;if(!(min>0)||max<min||max>2400)return null;return {min:+min.toFixed(4),max:+max.toFixed(4),unit:'in',printed:clean(m[0])};}
// Keep alternative layouts distinct. A guide for determinate and indeterminate
// tomatoes, for example, cannot supply one automatic plant-spacing default.
function growingSpacing(pairs,rawText,facts,evidence,warnings){
 const labels={inRow:/^(?:in[- ]row spacing|spacing in row|seed or plant spacing in row|plant spacing|final spacing|spacing between plants|plants apart)$/i,rowSpacing:/^(?:row spacing|spacing between rows|seed or plant spacing between rows|between[- ]row spacing|rows apart)$/i};
 for(const [key,re] of Object.entries(labels)){
  const candidates=[];
  const add=(value,label)=>{const parsed=measure(value);if(parsed)candidates.push({value:parsed,source:{label,value:clean(value)}});};
  for(const p of pairs.filter(p=>re.test(p.label)))for(const m of p.value.matchAll(new RegExp(measurement,'gi')))add(m[0],p.label);
  for(const chunk of rawText.split(/\n|(?<=[.!?])\s+/)){
   const expressions=key==='inRow'?['\\bspace\\s+(?:plants?|transplants?|seedlings?)\\s+('+measurement+')\\s+apart','\\b(?:determinates?|indeterminates?)\\s+('+measurement+')','('+measurement+')\\s+between\\s+plants?\\b']:['\\brows?\\s+('+measurement+')\\s+apart','('+measurement+')\\s+between\\s+rows?\\b'];
   for(const pattern of expressions)for(const m of chunk.matchAll(new RegExp(pattern,'gi'))){if(/\b(?:flats?|pots?|plug trays?|seed trays?)\b/i.test(chunk.slice(Math.max(0,m.index-70),m.index+m[0].length+45)))continue;add(m[1],'Growing instructions');}
  }
  const distinct=[...new Map(candidates.map(c=>[c.value.min+':'+c.value.max,c])).values()];
  if(distinct.length===1){facts[key]=distinct[0].value;evidence[key]=distinct[0].source;}
  else if(distinct.length>1){delete facts[key];evidence[key]={label:'Alternative spacing instructions',value:distinct.map(c=>c.value.printed).join(' or ')};warnings.push('The supplier gives alternative '+(key==='inRow'?'in-row':'between-row')+' spacings ('+evidence[key].value+'). Choose the layout you intend to use; no spacing is selected automatically.');}
 }
}
function packageSeedCount(label,packet){
 if(/^(?:packet|pkt)$/i.test(clean(label)))return packet||null;
 const m=String(label).match(/(?:^|[\s/])([\d,]+)\s*(?:seeds?|sds?)\b(?!\s*(?:\/|per)\s*[a-z])/i);return m?number(m[1]):null;
}
function textPackagePrices(rawText,currency,packet){
 // The gap must contain only purchase-status wording. It cannot cross seed
 // densities, another size choice, bulk-discount thresholds or growing text.
 const pattern=/\b(packet|pkt|[\d,]+(?:\.\d+)?(?:\s*\/\s*\d+)?\s*(?:seeds?|oz|ounces?|g|grams?|lbs?|pounds?))\b(?!\s*(?:\/|per)\s*[a-z])((?:\s|:|[-–—]|in stock|out of stock|each|price|from|starting at|sale|regular price)*)\$\s*([\d,]+(?:\.\d{1,2})?)/gi;
 const prices=[];for(const m of rawText.matchAll(pattern)){if(m[2].length>80)continue;const price=number(m[3]),label=clean(m[1]);if(price>0&&price<100000)prices.push({label,price,currency,seeds:packageSeedCount(label,packet)});if(prices.length>=75)break;}return prices;
}
function range(value){const m=String(value).match(/\b(\d{1,3})(?:\s*(?:[-–—]|to)\s*(\d{1,3}))?\s*(?:days?|weeks?)?/i);if(!m)return null;const min=+m[1],max=+(m[2]||m[1]);return min>0&&max>=min&&max<=3650?{min,max,printed:clean(m[0])}:null;}
function nurseryTiming(pairs,rawText){
 const candidates=[],quantity='\\b(\\d{1,3}(?:\\.\\d+)?)(?:\\s*(?:[-–—]|to)\\s*(\\d{1,3}(?:\\.\\d+)?))?',duration=quantity+'\\s*-?\\s*(days?|weeks?)\\b';
 const add=(value,label,context,defaultUnit='')=>{
  const m=String(value).match(new RegExp(duration,'i'))||defaultUnit&&String(value).match(new RegExp('^\\s*'+quantity+'\\s*$','i'));if(!m)return;
  const min=+m[1],max=+(m[2]??m[1]),unit=m[3]||defaultUnit,factor=/^week/i.test(unit)?7:1,days={min:+(min*factor).toFixed(6),max:+(max*factor).toFixed(6)};
  if(min<0||max<min||days.max>728)return;
  candidates.push({days,weeks:{min:+(days.min/7).toFixed(6),max:+(days.max/7).toFixed(6)},unit:/^week/i.test(unit)?'weeks':'days',printed:m[3]?clean(m[0]):clean(m[0])+' '+defaultUnit,source:{label,value:clean(context)}});
 };
 for(const p of pairs){
  if(/^(?:weeks? (?:from (?:sowing|seeding|seed) to transplant(?:ing)?|to transplant|in (?:the )?nursery)|nursery weeks?)$/i.test(p.label))add(p.value,p.label,p.value,'weeks');
  else if(/^(?:days? (?:in (?:the )?nursery|from (?:sowing|seeding|seed) to transplant(?:ing)?|to transplant)|nursery days?)$/i.test(p.label))add(p.value,p.label,p.value,'days');
  else if(/^(?:nursery (?:time|duration)|transplant age|seedling age)$/i.test(p.label))add(p.value,p.label,p.value);
 }
 for(const chunk of rawText.split(/\n|(?<=[.!?])\s+/)){
  for(const m of chunk.matchAll(new RegExp(duration+'\\s+(?:before|prior to|ahead of)\\s+(?:(?:the|field|outdoor)\\s+)?(?:transplant(?:ing)?|planting\\s+(?:outdoors?|out|date)|setting\\s+out|plant[- ]out)\\b','gi'))){
   const prefix=chunk.slice(Math.max(0,m.index-200),m.index);
   const following=chunk.slice(m.index+m[0].length,m.index+m[0].length+100);
   if(!/\b(?:sow(?:ing)?|seeds?|seeding|start(?:ing)?\s+(?:indoors|plants))\b/i.test(prefix)&&!/^\s*[,;]?\s*(?:sow|start\s+seeds?)\b/i.test(following)||/\b(?:harden\w*|fertili\w*|reduc\w*|cool\w*)\b/i.test(prefix))continue;
   add(m[0],'Seed-starting instructions',chunk);
  }
  for(const m of chunk.matchAll(new RegExp(duration+'\\s+(?:after|from)\\s+(?:sowing|seeding)\\b','gi'))){
   const prefix=chunk.slice(Math.max(0,m.index-100),m.index);if(/\btransplant(?:ing)?\b/i.test(prefix)&&!/\b(?:harvest|matur|bloom|flower)/i.test(prefix))add(m[0],'Transplanting instructions',chunk);
  }
  for(const m of chunk.matchAll(new RegExp(duration+'(?:\\s+|-)old\\b','gi'))){
   if(/\btransplant\w*\b|\b(?:plant|set)\b[^.!?\n]{0,100}\b(?:outdoors?|out)\b/i.test(chunk)&&!/\b(?:harvest\w*|germin\w*|harden\w*)\b/i.test(chunk))add(m[0],'Transplant age',chunk);
  }
 }
 const unique=[...new Map(candidates.map(x=>[x.days.min+':'+x.days.max,x])).values()];
 if(unique.length!==1)return {conflict:unique.length>1};
 const v=unique[0],printed=(range,unit)=>range.min+(range.min===range.max?'':'–'+range.max)+' '+unit;
 return {days:{...v.days,unit:'days',printed:v.unit==='days'?v.printed:printed(v.days,'days'),...(v.unit==='weeks'?{convertedFrom:'nurseryWeeks'}:{})},weeks:{...v.weeks,unit:'weeks',printed:v.unit==='weeks'?v.printed:printed(v.weeks,'weeks'),...(v.unit==='days'?{convertedFrom:'nurseryDays'}:{})},evidence:v.source};
}
// Rupp's category is the h1; the variety and attributes use a separate product
// block. Require its item number so a category or growing guide is not imported.
function ruppProduct(all,url){
 if(!/^(?:www\.)?ruppseeds\.com$/i.test(new URL(url).hostname))return null;
 const hasClass=(n,c)=>attr(n,'class').split(/\s+/).includes(c),root=all.find(n=>hasClass(n,'product'));
 if(!root)return null;const parts=nodes(root),heading=parts.find(n=>/^h[1-6]$/.test(n.name||'')&&hasClass(n,'productName'));
 const pairs=parts.filter(n=>hasClass(n,'attribute-row')).map(n=>({label:clean(text(nodes(n).find(x=>hasClass(x,'attribute-label')))),value:clean(text(nodes(n).find(x=>hasClass(x,'attribute-data'))))})).filter(x=>x.label&&x.value);
 const sku=pairs.find(x=>/^item number$/i.test(x.label))?.value;
 if(!heading||!clean(text(heading))||!sku||!/^V\d{3,12}[A-Z0-9-]*$/i.test(sku))return null;
 const images=[];for(const link of parts.filter(n=>n.name==='a'&&/^#[\w-]+$/.test(attr(n,'data-target')))){
  const modal=all.find(n=>attr(n,'id')===attr(link,'data-target').slice(1));
  for(const img of nodes(modal).filter(n=>n?.name==='img')){const image=absolute(attr(img,'src'),url);if(image&&/\/Files\/Images\/Products\//i.test(new URL(image).pathname)&&new URL(image).hostname===new URL(url).hostname)images.push(image);}
 }
 const tables=parts.filter(n=>n.name==='table'&&/Treatment[\s\S]*Pkg Size[\s\S]*Price \(USD\)/i.test(text(n))),prices=[];
 const thousands=/\bM\s*=\s*1,?000\b/i.test(text(root));
 for(const table of tables)for(const row of nodes(table).filter(n=>n.name==='tr')){
  const cells=children(row).filter(n=>n.name==='td').map(n=>clean(text(n)));if(cells.length!==3)continue;
  const size=cells[1].match(/^([\d,]+(?:\.\d+)?)\s*(M)?\s+seeds?$/i),price=cells[2].match(/^\$\s*([\d,]+(?:\.\d{1,2})?)$/);
  if(!size||size[2]&&!thousands||!price)continue;const seeds=number(size[1])*(size[2]?1000:1),amount=number(price[1]);
  if(!(seeds>0&&Number.isInteger(seeds)&&amount>0&&amount<100000))continue;
  const label=seeds.toLocaleString('en-US')+' seeds'+(cells[0]?' · '+cells[0]:'');
  if(!prices.some(p=>p.label===label&&p.price===amount))prices.push({label,price:amount,currency:'USD',seeds});
 }
 return {heading,pairs,sku,images,prices,tables};
}
const berbeeHost=u=>/^(?:www\.)?berbeeus\.com$/i.test(u.hostname);
const htmlEscape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function berbeeHTMLProduct(all,url){
 if(!berbeeHost(new URL(url)))return null;
 const scope=all.find(n=>/\bproduct-details-full-main-content\b/.test(attr(n,'class')));if(!scope)return null;
 const own=nodes(scope),heading=own.find(n=>n.name==='h1'&&attr(n,'itemprop')==='name'),sku=clean(text(own.find(n=>attr(n,'itemprop')==='sku')));
 if(!heading||!sku)return null;
 const gallery=own.find(n=>attr(n,'data-view')==='Product.ImageGallery');
 return {'@type':'Product',name:clean(text(heading)),sku,brand:{name:'Leo Berbee Bulb Company'},image:gallery?nodes(gallery).filter(n=>n.name==='img').map(n=>absolute(attr(n,'data-src')||attr(n,'src'),url)).filter(Boolean):[]};
}
export function parseProductHTML(html,url){
 let finalURL=canonical(url);const dom=parseDocument(html,{decodeEntities:true}),all=nodes(dom),meta={};const declared=all.find(n=>n.name==='link'&&attr(n,'rel').toLowerCase()==='canonical'),declaredURL=absolute(attr(declared,'href'),finalURL);if(declaredURL&&new URL(declaredURL).hostname===new URL(finalURL).hostname)finalURL=canonical(declaredURL);for(const n of all.filter(n=>n.name==='meta')){const key=(attr(n,'property')||attr(n,'name')).toLowerCase();if(key&&!meta[key])meta[key]=attr(n,'content');}
 const rupp=ruppProduct(all,finalURL),h1=rupp?.heading||all.find(n=>n.name==='h1'),heading=clean(text(h1)),pageTitle=clean(text(all.find(n=>n.name==='title'))),products=structured(all);
 const berbee=berbeeHTMLProduct(all,finalURL);if(!products.length&&berbee)products.push(berbee);
 if(berbeeHost(new URL(finalURL))&&!heading&&!products.length&&/SuiteCommerce|shopping\.environment/.test(html))fail('This saved HTML contains only Berbee’s empty JavaScript page. Use Read variety with the product URL, or copy the displayed product details.');
 const scored=products.map(p=>{const pURL=absolute(p.url||p['@id']||'',finalURL),name=clean(p.name||p.title);return {p,name,score:(pURL&&canonical(pURL)===finalURL?10:0)+(heading&&normalize(name)===normalize(heading)?8:heading&&normalize(heading).includes(normalize(name))?4:0)+(p.sku?1:0)};}).sort((a,b)=>b.score-a.score);
 const selected=scored[0],ambiguous=scored.length>1&&selected.score<=1;
 if(ambiguous)fail('This page contains several products. Paste the URL for one specific variety.');
 const product=selected?.p||{},name=clean(product.name||product.title||heading||meta['og:title']||pageTitle).replace(/\s*[|–—]\s*(?:Johnny.*|Harris Seeds.*|High Mowing.*|Burpee.*|Baker Creek.*|Territorial.*|Paramount Seeds.*|Osborne Seed.*)$/i,'').slice(0,200);
 const main=(berbee&&all.find(n=>/\bproduct-details-full-main-content\b/.test(attr(n,'class'))))||all.find(n=>n.name==='main')||all.find(n=>attr(n,'itemtype').includes('/Product'))||dom;
 const rawText=text(main).split(/\n/).map(clean).filter(Boolean).join('\n'),description=clean(product.description?text(parseDocument(String(product.description))):meta['og:description']||meta.description||'');
 // Fedco uses website metadata and inert package attributes rather than Product
 // JSON-LD. Require the product heading and a matching item marker, not just a slug.
 const fedcoCode=/^(?:www\.)?fedcoseeds\.com$/.test(new URL(finalURL).hostname)&&new URL(finalURL).pathname.match(/^\/(?:moose|seeds|trees)\/[^/]+-(\d+)$/)?.[1];
 const fedcoItem=fedcoCode&&/\bproduct-name\b/.test(attr(h1,'class'))&&all.some(n=>attr(n,'data-fedco-item')===fedcoCode||n.name==='img'&&attr(n,'id')===fedcoCode)?fedcoCode:'';
 if(!name||/^(?:access denied|just a moment|verify|sign in|403|404|page not found|you are being redirected)/i.test(name)||(/captcha|verify you are human|checking your browser|javascript is required/i.test(rawText.slice(0,2000))&&!product.sku))fail('The supplier returned a verification page. Paste product text or a saved HTML page instead.');
 if(!products.length&&meta['og:type']==='article')fail('This is an article, not a variety product page. Paste the specific product URL.');
 if(!products.length&&!fedcoItem&&!rupp&&!meta['og:type']?.includes('product')&&(/^(?:www\.)?ruppseeds\.com$/i.test(new URL(finalURL).hostname)||berbeeHost(new URL(finalURL))||!/product id|\bsku\b|days to maturity|maturation days|seeds?\/oz|plant spacing/i.test(rawText)))fail('A specific variety could not be identified on this page. Paste its product URL or product text.');
 const pairs=[];const addPair=(label,value)=>{label=clean(label).replace(/:$/,'');value=clean(value);if(label&&value&&label.length<110&&value.length<3000&&!pairs.some(p=>p.label===label&&p.value===value))pairs.push({label,value});};
 for(const pair of rupp?.pairs||[])addPair(pair.label,pair.value);
 for(const n of nodes(main)){
  if(rupp&&(n===rupp.heading||rupp.tables.some(t=>{for(let p=n;p;p=p.parent)if(p===t)return true;return false;})))continue;
  if(n.name==='tr'){const cells=children(n).filter(c=>['td','th'].includes(c.name));if(cells.length>=2)addPair(text(cells[0]),cells.slice(1).map(text).join(' '));}
  if(n.name==='dt'){const siblings=children(n.parent),i=siblings.indexOf(n),next=siblings.slice(i+1).find(c=>c.type!=='text'||clean(c.data));if(next?.name==='dd')addPair(text(children(n).find(c=>/^h[1-6]$/.test(c.name||''))||n),text(next));}
  if(['h2','h3','h4','strong','b'].includes(n.name)){const label=clean(text(n));if(label.length<90){const siblings=children(n.parent),i=siblings.indexOf(n),following=[];for(const c of siblings.slice(i+1)){if(/^h[1-6]$/.test(c.name||''))break;if(clean(text(c)))following.push(text(c));if(following.join(' ').length>350)break;}const value=clean(following.join(' '));if(value&&value.length<500)addPair(label,value);}}
 }
 for(const a of [].concat(product.additionalProperty||[]))if(a&&typeof a==='object')addPair(a.name,a.value?.value??a.value);
 const lines=rawText.split('\n');for(let i=0;i<lines.length;i++){const m=lines[i].match(/^([^:]{2,75}):\s*(.*)$/);if(m)addPair(m[1],m[2]||lines[i+1]||'');else if(/^(?:days? to maturity|maturation days|days? to germ(?:ination)?|in[- ]row spacing|plant spacing|spacing between rows|row spacing|weeks from sowing to transplant|seeding depth|planting depth|latin name|botanical name|life cycle|hybrid status|germination rate|minimum germination|seeds? per gram|seeds? per ounce|seeds? per pound|seed depth|days? to emergence)$/i.test(lines[i]))addPair(lines[i],lines[i+1]||'');}
 const facts={},evidence={},warnings=[];
 const pick=(key,re,parse=v=>v)=>{const candidates=pairs.filter(p=>re.test(p.label)&&p.value.length<250&&normalize(p.value)!==normalize(p.label)&&!/About Quick Fact|Choose an option|offspring of a cross|Plants can be Annuals/i.test(p.value)).map(p=>({value:parse(p.value),source:p})).filter(p=>p.value!=null);const distinct=new Set(candidates.map(x=>JSON.stringify(typeof x.value==='string'?normalize(x.value):x.value)));if(distinct.size===1){facts[key]=candidates[0].value;evidence[key]=candidates[0].source;}else if(distinct.size>1)warnings.push('Conflicting '+key+' values were found; choose the correct one in review.');};
 pick('maturity',/^(?:days? to maturity|maturation days|maturity days|maturity(?: \(days\))?|dtm)$/i,range);
 if(!facts.maturity){const matches=[...((description||'')+'\n'+rawText.slice(0,1800)).matchAll(/\b(\d{2,3})(?:\s*[-–]\s*(\d{2,3}))?\s*days?\b/gi)].filter(m=>!/(?:germin|shipping|delivery|return|before|after)/i.test(m.input.slice(Math.max(0,m.index-35),m.index)));const ranges=[...new Map(matches.map(m=>[m[0],range(m[0])])).values()];if(ranges.length===1){facts.maturity=ranges[0];evidence.maturity={label:'Product maturity text',value:matches[0][0]};}}
 const basisPairs=pairs.filter(p=>/^(?:days? to maturity|maturity starts|maturity basis|dtm basis)$/i.test(p.label)),basisText=basisPairs.map(p=>p.value).join(' ');const explicit=basisPairs.map(p=>p.value.match(/^from\s+(?:the\s+)?(?:date\s+of\s+)?(transplants?|transplanting|seed|seeding|sowing)\s*(?:\.(?:\s|$)|$)/i)?.[1]).filter(Boolean).map(x=>/^transplant/i.test(x)?'transplant':'seed');const clockStatements=rawText.split('\n').filter(v=>/days? to maturity.*?\bfrom\b/i.test(v));const clocks=explicit.length?explicit:[];for(const v of explicit.length?[]:[basisText,description,...clockStatements]){if(/\bfrom\s+(?:field\s+)?transplants?\b|\bafter transplanting\b/i.test(v))clocks.push('transplant');if(/\bfrom\s+(?:the\s+)?(?:date\s+of\s+)?(?:direct\s+)?(?:seed|seeding|sowing)\b|\bafter sowing\b/i.test(v))clocks.push('seed');}facts.maturityBasis=[...new Set(clocks)].length===1?clocks[0]:'unspecified';if(facts.maturity&&facts.maturityBasis==='unspecified')warnings.push('The maturity starting point is not unambiguous. Confirm seeding versus transplanting before relying on its dates.');
 growingSpacing(pairs,rawText,facts,evidence,warnings);pick('depth',/^(?:seeding depth|planting depth|seed depth|seed or plant spacing depth)$/i);pick('germinationDays',/^(?:germination days|days? to emergence|days? to germ(?:ination)?\.?|days? to germ\.)$/i,range);pick('latin',/^(?:latin name|botanical name|scientific name)$/i,v=>v.match(/^[A-Z][a-z]+\s+[a-z]+(?:\s+(?:var\.|subsp\.)\s+[a-z]+)?/)?.[0]||null);pick('lifeCycle',/^(?:life cycle|plant type)$/i,v=>/^(?:annual|biennial|perennial|tender perennial)s?$/i.test(v)?v:null);pick('hybridStatus',/^(?:hybrid status|hybrid)$/i,v=>/^yes$/i.test(v)?'Hybrid':/^(?:hybrid(?: \(F1\))?|open[- ]pollinated|heirloom)$/i.test(v)?v:null);pick('light',/^(?:light|sun|sun requirements|light requirements)$/i);pick('height',/^(?:plant height|height)$/i);pick('spread',/^(?:plant spread|spread)$/i);pick('germinationPercent',/^(?:germination rate|minimum germination|germination %|germination percentage)$/i,v=>{const m=v.match(/(\d+(?:\.\d+)?)\s*%/);return m&&+m[1]>0&&+m[1]<=100?+m[1]:null;});
 const nursery=nurseryTiming(pairs,rawText);if(nursery.days){facts.nurseryDays=nursery.days;facts.nurseryWeeks=nursery.weeks;evidence.nurseryDays=evidence.nurseryWeeks=nursery.evidence;}else if(nursery.conflict)warnings.push('Conflicting nursery timing was found; choose the correct duration in review.');
 const square=description.match(/(?:plants? can be |plants? are |plant |space plants? )?spaced?\s+(\d+\s*[½¼¾]?|\d+(?:\.\d+)?)\s*(?:by|×|x)\s*(\d+\s*[½¼¾]?|\d+(?:\.\d+)?)\s*(?:inches?|["″])/i);
 if(square){facts.inRow={min:number(square[1]),max:number(square[1]),unit:'in',printed:square[0]};facts.rowSpacing={min:number(square[2]),max:number(square[2]),unit:'in',printed:square[0]};evidence.inRow=evidence.rowSpacing={label:'Variety-specific spacing',value:square[0]};warnings.push('Variety-specific spacing is used; the page’s general crop guide is retained in source details.');}
 const spacing=pairs.find(p=>/^spacing$/i.test(p.label));if(spacing){const plants=spacing.value.match(/plants?\s+(.+?)\s+apart/i),rows=spacing.value.match(/rows?\s+(.+?)\s+apart/i);if(plants&&!facts.inRow){facts.inRow=measure(plants[1]);evidence.inRow=spacing;}if(rows&&!facts.rowSpacing){facts.rowSpacing=measure(rows[1]);evidence.rowSpacing=spacing;}}
 for(const [key,unit] of [['seedsPerOz','(?:oz|ounce)'],['seedsPerG','(?:g|gram)'],['seedsPerLb','(?:lb|pound)']]){const m=rawText.match(new RegExp('([\\d,]+)\\s*(?:seeds?|sds?)\\s*(?:/|per)\\s*'+unit+'\\b','i'));if(m){facts[key]=number(m[1]);evidence[key]={label:'Seed count',value:m[0]};}}
 for(const [key,label] of [['seedsPerOz','ounce'],['seedsPerG','gram'],['seedsPerLb','pound']]){if(facts[key])continue;const pair=pairs.find(p=>new RegExp('^seeds? per '+label+'$','i').test(p.label)),count=pair?.value.match(/[\d,]+/);if(count){facts[key]=number(count[0]);evidence[key]=pair;}else{const p=pairs.find(p=>/^seed count$/i.test(p.label)),m=p?.value.match(new RegExp('([\\d,]+)\\s*(?:seeds?\\s*)?per '+label,'i'));if(m){facts[key]=number(m[1]);evidence[key]=p;}}}
 const packet=rawText.match(/(?:packet|pkt)\s*[:–—-]?\s*([\d,]+)\s*seeds?\b/i);if(packet){facts.seedsPerPacket=number(packet[1]);evidence.seedsPerPacket={label:'Packet size',value:packet[0]};}
 const latin=description.match(/\b(?:Solanum|Lactuca|Brassica|Cucumis|Capsicum|Daucus|Allium|Pisum|Phaseolus|Ocimum|Zinnia)\s+[a-z]+\b/);if(!facts.latin&&latin)facts.latin=latin[0];
 const supplier=clean(meta['og:site_name']||product.brand?.name||(typeof product.brand==='string'?product.brand:'')||(fedcoItem?'Fedco Seeds':rupp?'Rupp Seeds':'')||new URL(finalURL).hostname.replace(/^www\./,''));
 const master=all.find(n=>/\bmaster-product-id\b/.test(attr(n,'class'))),sku=clean(text(master)||product.sku||product.mpn||fedcoItem||rupp?.sku||rawText.match(/(?:product id|\bsku|item (?:number|no\.?))\s*[:#]?\s*([A-Z0-9][A-Z0-9.\-]{1,49})/i)?.[1]||'');
 const productCodes=[];const addCode=(value,kind)=>{value=clean(value);if(value&&!productCodes.some(x=>x.value===value))productCodes.push({value,kind});};addCode(sku,'product');for(const p of scored)if(p.score>1){addCode(p.p.sku,p.p===product?'product':'package');for(const v of p.p.variants||[])addCode(v.sku,'package');for(const v of p.p.hasVariant||[])addCode(v.sku,'package');}
 // Modern Shopify themes may publish only the variant array as JSON.
 const looseVariants=[];for(const n of all.filter(n=>n.name==='script'&&attr(n,'type')==='application/json')){let arr;try{arr=JSON.parse(children(n).map(x=>x.data||'').join(''));}catch{continue;}if(Array.isArray(arr)&&arr.length&&arr.every(v=>v&&typeof v==='object'&&v.sku&&v.title&&v.price!=null&&v.option1!==undefined))for(const v of arr.slice(0,75))if(!looseVariants.some(x=>x.sku===v.sku)){looseVariants.push(v);addCode(v.sku,'package');}}

 const images=[];const addImage=(value,origin)=>{if(value&&typeof value==='object')value=value.url||value.contentUrl;const u=absolute(value||'',finalURL);if(u&&!/logo|icon|badge|placeholder|\.svg(?:\?|$)/i.test(u)&&!images.some(x=>x.url===u))images.push({url:u,source:origin});};for(const v of rupp?.images||[])addImage(v,'Product image markup');for(const v of [].concat(product.image||[]))addImage(v,'Product structured data');addImage(meta['og:image:secure_url']||meta['og:image'],'Product page image');addImage(meta['twitter:image'],'Product page image');
 if(!images.length)for(const n of nodes(main).filter(n=>n.name==='img')){
  // Fedco advertises its logo in og:image, while the actual item photo is a
  // zoom link / lazy data-original image identified by its descriptive alt.
  let excluded=false;for(let p=n.parent;p;p=p.parent)if(omitted(p)){excluded=true;break;}
  if(excluded)continue;
  const marker=attr(n,'class')+' '+attr(n.parent,'class')+' '+attr(n,'itemprop');
  if(!/product|main|hero/i.test(marker)&&!/(?:main(?: full-size)? item image|product (?:image|photo))/i.test(attr(n,'alt')))continue;
  const zoom=n.parent?.name==='a'&&/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(attr(n.parent,'href'))?attr(n.parent,'href'):'';
  addImage(zoom||attr(n,'data-original')||attr(n,'data-src')||attr(n,'src'),'Product image markup');
 }
 const prices=[...(rupp?.prices||[])];const offers=[].concat(product.offers?.offers||product.offers||[],...(product.hasVariant||[]).map(v=>[].concat(v.offers||[]).map(o=>({...o,name:o.name||v.name})))).flat();for(const offer of offers.slice(0,50)){if(!offer||typeof offer!=='object')continue;const price=Number(offer.price);if(Number.isFinite(price)&&price>0)prices.push({label:clean(offer.name||offer.sku||'Listed offer'),price,currency:clean(offer.priceCurrency||''),url:absolute(offer.url||'',finalURL),seeds:null});}
 for(const v of [...(product.variants||[]),...looseVariants].slice(0,75)){const price=Number(v.price);if(Number.isFinite(price)&&price>0)prices.push({label:clean(v.public_title||v.title),price:price/100,currency:'',seeds:null});}
 for(const n of all.filter(n=>attr(n,'data-product_variations'))){let variants;try{variants=JSON.parse(attr(n,'data-product_variations'));}catch{continue;}if(!Array.isArray(variants))continue;for(const v of variants.slice(0,75)){const price=Number(v.display_price),label=Object.values(v.attributes||{}).map(clean).filter(Boolean).join(' / ');if(price>0&&label&&!prices.some(p=>p.label===label&&p.price===price))prices.push({label,price,currency:meta['product:price:currency']||'',seeds:null});addCode(v.sku,'package');}}
 // Magento publishes explicit option prices in inert initialization JSON.
 for(const n of all.filter(n=>n.name==='script'&&/x-magento-init/i.test(attr(n,'type')))){const raw=children(n).map(x=>x.data||'').join('');if(raw.length>600000)continue;let config;try{config=JSON.parse(raw);}catch{continue;}const visit=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>12)return;if(v.optionPrices&&v.attributes){for(const [id,offer] of Object.entries(v.optionPrices).slice(0,75)){const price=Number(offer?.finalPrice?.amount),label=Object.values(v.attributes).map(a=>(Array.isArray(a?.options)?a.options:[]).find(o=>Array.isArray(o?.products)&&o.products.map(String).includes(id))?.label).filter(Boolean).join(' / ');if(price>0&&label&&!prices.some(p=>p.label===label&&p.price===price))prices.push({label,price,currency:meta['product:price:currency']||'',seeds:null});}}for(const child of Object.values(v).slice(0,500))visit(child,depth+1);};visit(config);}
 if(fedcoItem)for(const n of all.filter(n=>attr(n,'data-fedco-item')===fedcoItem).slice(0,75)){
  let pack;try{pack=JSON.parse(attr(n,'data-fedco-itemsize'));}catch{continue;}
  const size=clean(pack.size),amount=clean(pack.display_amount),unit=clean(pack.unit),price=Number(pack.price);
  if(String(pack.number)!==fedcoItem||!size||size!==attr(n,'data-fedco-size')||!(number(amount)>0)||!unit||!(price>0&&price<100000))continue;
  const label=amount+' '+unit;addCode(fedcoItem+'-'+size,'package');
  if(!prices.some(p=>p.label===label&&p.price===price))prices.push({label,price,currency:'USD',seeds:null});
 }
 if(!prices.length){const price=Number(meta['product:price:amount']);if(price>0)prices.push({label:'Listed starting price · package not specified',price,currency:meta['product:price:currency']||'',seeds:null});}
 const currency=prices.find(p=>p.currency)?.currency||meta['product:price:currency']||'$';for(const p of prices)p.seeds=packageSeedCount(p.label,facts.seedsPerPacket);for(const p of rupp?[]:textPackagePrices(rawText,currency,facts.seedsPerPacket)){if(!prices.some(x=>normalize(x.label)===normalize(p.label)))prices.push(p);if(prices.length>=75)break;}
 if(!facts.maturity)warnings.push('Maturity was not reliably found; the importer will leave it blank.');if(!images.length)warnings.push('No product photo was found.');
 const textTruncated=rawText.length>LINK_LIMITS.text;return {v:1,url:finalURL,name,sku,productCodes,supplier,description:description.slice(0,16000),facts,evidence,specifications:pairs.slice(0,150),prices,images:images.slice(0,8),sourceText:rawText.slice(0,LINK_LIMITS.text),textTruncated,warnings,extraction:products.length?'structured product data + product text':'product page metadata + product text'};
}
async function readBerbeeProduct(url,options){
 const u=publicURL(url),slug=u.pathname.slice(1);
 if(!slug||!/^[\w-]+$/.test(slug))fail('Paste the link to one Berbee variety product page.');
 const endpoint=new URL('/api/items',u);endpoint.searchParams.set('url',slug);endpoint.searchParams.set('fieldset','details');
 const source=await fetchPublic(endpoint.href,{...options,json:true});
 if(!berbeeHost(new URL(source.url)))fail('The supplier product data could not be read.');
 let data;try{data=JSON.parse(new TextDecoder().decode(source.bytes));}catch{fail('The supplier product data could not be read.');}
 const items=Array.isArray(data?.items)?data.items.filter(x=>x&&x.urlcomponent===slug):[];
 if(items.length!==1||!items[0].itemid)fail('A specific Berbee variety could not be identified. Check the product link.');
 const item=items[0],name=clean(item.storedisplayname2||item.storedescription||item.displayname);
 if(!name)fail('The Berbee product is missing its variety name.');
 const pairs=[['Height',item.custitem_height],['Color',item.custitem_color],['Hardiness zone',item.custitem_hardiness_zone],['Shipping window',item.custitemshipwindow],['Sales unit',item.saleunit],['Availability',item.outofstockmessage]];
 const images=Object.values(item.itemimages_detail||{}).flatMap(group=>Array.isArray(group?.urls)?group.urls.map(x=>x?.url):[]).filter(x=>typeof x==='string').slice(0,8);
 const product={'@type':'Product',name,sku:clean(item.itemid),brand:{name:'Leo Berbee Bulb Company'},description:item.storedetaileddescription||item.storedescription||'',image:images};
 // A guest feed can include account pricing even while explicitly hiding it.
 // Only expose an offer if the supplier marks that price as public.
 const price=item.onlinecustomerprice_detail?.onlinecustomerprice;
 if(item.ispricevisible===true&&typeof price==='number'&&price>0)product.offers={name:clean(item.saleunit)||'Listed offer',price,priceCurrency:clean(data.locale?.currency)};
 const description=text(parseDocument(String(product.description)));
 const html='<main><h1>'+htmlEscape(name)+'</h1><script type="application/ld+json">'+JSON.stringify(product).replace(/</g,'\\u003c')+'</script><p>'+htmlEscape(description)+'</p><dl>'+pairs.filter(([,v])=>v).map(([k,v])=>'<dt>'+htmlEscape(k)+'</dt><dd>'+htmlEscape(v)+'</dd>').join('')+'</dl></main>';
 const result=parseProductHTML(html,u.href);result.extraction='Berbee public product data';
 if(item.ispricevisible!==true)result.warnings.push('Berbee requires sign-in to view pricing; no account price was imported.');
 return result;
}
export async function readProductLink(url,options={}){const u=publicURL(url);let result;if(berbeeHost(u))result=await readBerbeeProduct(u.href,options);else{const source=await fetchPublic(u.href,options);result=parseProductHTML(new TextDecoder().decode(source.bytes),source.url);}return {...result,retrievedAt:(options.now?.()||new Date()).toISOString()};}
export function readPastedProduct(value,url,name,now=()=>new Date()){
 if(typeof value!=='string'||!value.trim()||value.length>96000)fail('Paste product details up to 96,000 characters.',400);
 if(typeof name!=='string'||!name.trim()||name.length>200)fail('Enter the variety name for the pasted details.',400);
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const html=/<(?:html|body|main|script)\b/i.test(value)?value:`<html><head><meta property="og:type" content="product"></head><body><main><h1>${escape(name)}</h1>${value.split(/\r?\n/).map(line=>'<p>'+escape(line)+'</p>').join('')}</main></body></html>`;
 const result=parseProductHTML(html,url);result.extraction='User-pasted product details';result.retrievedAt=now().toISOString();result.warnings.unshift('These details were pasted by you. Confirm that they match the linked product.');return result;
}
