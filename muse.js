'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const field = $('field'), graph = $('spectrum');
 const ctx = field.getContext('2d'), g = graph.getContext('2d');
 let meta, spectra, footprint, maskBits, background, nebula, ready=false;
 let lineView=true;
 let catalog=[], currentId, loadVersion=0, windowLow=0, windowHigh=0, dragStart=null;
 let selection=null, locked=false, hovered=false, zoom=2.6, opacity=.85, radius=1;
 let spectrum=null, camera, geometry, graphHover=null;
 const image = url => new Promise((resolve,reject) => {const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Image could not be loaded'));im.src=url;});
 function size(canvas, context) {
  const rect=canvas.getBoundingClientRect(), ratio=window.devicePixelRatio||1;
  const w=Math.round(rect.width*ratio),h=Math.round(rect.height*ratio);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  context.setTransform(ratio,0,0,ratio,0,0);
  return [rect.width,rect.height];
 }
 function skyCoordinate(x,y){
  const w=meta.wcs,r=Math.PI/180;
  const dx=x+1-w.CRPIX1,dy=y+1-w.CRPIX2;
  const xi=(w.CD1_1*dx+w.CD1_2*dy)*r,eta=(w.CD2_1*dx+w.CD2_2*dy)*r;
  const ra0=w.CRVAL1*r,dec0=w.CRVAL2*r,denom=Math.cos(dec0)-eta*Math.sin(dec0);
  const ra=(ra0+Math.atan2(xi,denom))/r;
  const dec=Math.atan2(Math.sin(dec0)+eta*Math.cos(dec0),Math.hypot(denom,xi))/r;
  return `RA ${((ra+360)%360).toFixed(5)}° · Dec ${dec.toFixed(5)}°`;
 }
 function drawField(){
  if(!ready)return;
  const effectiveZoom=zoom===1?1:Math.max(1,Math.min(2.6,meta.width/(meta.crop.width*1.08),meta.height/(meta.crop.height*1.08)));
  const [w,h]=size(field,ctx);let sw=meta.width/effectiveZoom,sh=meta.height/effectiveZoom;
  if(sw/sh<w/h)sw=sh*w/h;else sh=sw*h/w;
  const centerX=meta.crop.x0+meta.crop.width/2,centerDisplayY=meta.height-1-(meta.crop.y0+meta.crop.height/2);
  camera={x:sw>meta.width?(meta.width-sw)/2:Math.max(0,Math.min(meta.width-sw,centerX-sw/2)),y:sh>meta.height?(meta.height-sh)/2:Math.max(0,Math.min(meta.height-sh,centerDisplayY-sh/2)),w:sw,h:sh};
  ctx.clearRect(0,0,w,h);ctx.imageSmoothingEnabled=false;
  ctx.drawImage(background,camera.x,camera.y,sw,sh,0,0,w,h);
  ctx.imageSmoothingEnabled=true;ctx.globalAlpha=opacity;ctx.drawImage(nebula,camera.x,camera.y,sw,sh,0,0,w,h);ctx.globalAlpha=1;
  if(selection){
   const px=(selection.x+.5-camera.x)/sw*w,py=(meta.height-1-selection.y+.5-camera.y)/sh*h;
   const aw=(2*radius+1)/sw*w,ah=(2*radius+1)/sh*h;
   ctx.strokeStyle=locked?'#ffdd83':'#f8fff1';ctx.lineWidth=1.4;
   ctx.beginPath();ctx.ellipse(px,py,Math.max(.5,radius)/sw*w,Math.max(.5,radius)/sh*h,0,0,Math.PI*2);ctx.stroke();
   ctx.beginPath();ctx.moveTo(px-12,py);ctx.lineTo(px-aw/2-3,py);ctx.moveTo(px+aw/2+3,py);ctx.lineTo(px+12,py);ctx.moveTo(px,py-12);ctx.lineTo(px,py-ah/2-3);ctx.moveTo(px,py+ah/2+3);ctx.lineTo(px,py+12);ctx.stroke();
  }
  // Scale bar in arcseconds; its pixel length follows the selected field of view.
  const length=(zoom===1?10:5),bar=(length/meta.pixelScaleArcsec)/sw*w;
  ctx.strokeStyle='#d5e5dc';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(18,h-25);ctx.lineTo(18+bar,h-25);ctx.stroke();
  ctx.font='10px -apple-system, sans-serif';ctx.fillStyle='#d5e5dc';ctx.fillText(`${length}″`,18,h-34);
 }
 function extract(){
  if(!selection){spectrum=null;return;}
  const n=meta.channels,c=meta.crop,values=new Float64Array(n),counts=new Uint16Array(n);let pixels=0;
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
   if(dx*dx+dy*dy>radius*radius)continue;
   const x=selection.x+dx-c.x0,y=selection.y+dy-c.y0;
   if(x<0||x>=c.width||y<0||y>=c.height)continue;
   pixels++;
   const offset=(y*c.width+x)*n;
   for(let k=0;k<n;k++){const v=spectra[offset+k];if(Number.isFinite(v)){values[k]+=v;counts[k]++;}}
  }
  for(let k=0;k<n;k++)if(!counts[k])values[k]=NaN;
  const incomplete=counts.some(count=>count!==pixels);
  spectrum={values,counts,pixels,incomplete};
  const angularRadius=radius*meta.pixelScaleArcsec;
  $('spectrum-title').textContent=`FITS pixel (${selection.x+1}, ${selection.y+1}) · ${radius===0?"single spaxel":`r = ${radius} pixels`}`;
  $('position').textContent=`FITS x ${selection.x+1} · y ${selection.y+1}${locked?' · locked':''}`;
  $('sky').textContent=skyCoordinate(selection.x,selection.y);
  const edge=selection.x-radius<0||selection.y-radius<0||selection.x+radius>=meta.width||selection.y+radius>=meta.height;
  $('spectrum-info').textContent=`Sum of ${pixels} spaxel${pixels===1?"":"s"} · radius ${angularRadius.toFixed(1)}″ · native units${edge?' · aperture clipped at field edge':''}${incomplete?' · non-finite samples omitted':''}`;
 }
 const numeric = v => Math.abs(v)>=1000||Math.abs(v)>0&&Math.abs(v)<.01?v.toExponential(1):Number(v.toPrecision(3)).toString();
 function drawGraph(){
  if(!ready)return;
  const [w,h]=size(graph,g),left=w<450?53:67,right=18,top=19,bottom=45;
  g.clearRect(0,0,w,h);g.fillStyle='#fcfcf6';g.fillRect(0,0,w,h);
  const first=lineView?Math.max(0,meta.maskChannels[0]-40):0,last=lineView?Math.min(meta.channels-1,meta.maskChannels[1]+40):meta.channels-1;
  const xmin=meta.wavelength0+first*meta.wavelengthStep,xmax=meta.wavelength0+last*meta.wavelengthStep;
  const pw=w-left-right,ph=h-top-bottom;
  const val=spectrum?.values;
  let ymin=0,ymax=1;
  if(val){let min=Infinity,max=-Infinity;for(const v of val.slice(first,last+1))if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}if(Number.isFinite(min)){ymin=Math.min(0,min);ymax=Math.max(0,max);const span=ymax-ymin||1;ymin-=.12*span;ymax+=.16*span;}}
  const X=v=>left+(v-xmin)/(xmax-xmin)*pw,Y=v=>top+(ymax-v)/(ymax-ymin)*ph;
  geometry={left,right,top,bottom,pw,ph,xmin,xmax,ymin,ymax,w,h};
  g.fillStyle='#e6eddc';g.fillRect(X(meta.maskWavelength[0]),top,X(meta.maskWavelength[1])-X(meta.maskWavelength[0]),ph);
  g.fillStyle='#eea14825';g.fillRect(X(meta.wavelength0+windowLow*meta.wavelengthStep),top,Math.max(1,X(meta.wavelength0+windowHigh*meta.wavelengthStep)-X(meta.wavelength0+windowLow*meta.wavelengthStep)),ph);
  g.strokeStyle='#b37626';g.setLineDash([5,3]);for(const k of [windowLow,windowHigh]){const xx=X(meta.wavelength0+k*meta.wavelengthStep);g.beginPath();g.moveTo(xx,top);g.lineTo(xx,top+ph);g.stroke();}g.setLineDash([]);
  g.font='10px -apple-system, sans-serif';g.lineWidth=1;
  for(let i=0;i<=4;i++){const v=ymin+(ymax-ymin)*i/4,y=Y(v);g.strokeStyle='#dfe5dc';g.beginPath();g.moveTo(left,y);g.lineTo(w-right,y);g.stroke();g.fillStyle='#63756e';g.textAlign='right';g.fillText(numeric(v),left-8,y+3);}
  const target=(xmax-xmin)/Math.max(2,pw/65),step=[10,20,25,50,100,200,250,500,1000].find(v=>v>=target)||2000,start=Math.ceil(xmin/step)*step;
  for(let v=start;v<=xmax;v+=step){const x=X(v);g.strokeStyle='#e2e7de';g.beginPath();g.moveTo(x,top);g.lineTo(x,h-bottom);g.stroke();g.fillStyle='#63756e';g.textAlign='center';g.fillText(String(v),x,h-bottom+17);}
  if(ymin<0&&ymax>0){g.strokeStyle='#9bad9f';g.setLineDash([4,4]);g.beginPath();g.moveTo(left,Y(0));g.lineTo(w-right,Y(0));g.stroke();g.setLineDash([]);}
  g.strokeStyle='#768d80';g.beginPath();g.moveTo(left,top);g.lineTo(left,h-bottom);g.lineTo(w-right,h-bottom);g.stroke();
  g.fillStyle='#50625b';g.textAlign='center';g.font='10px -apple-system, sans-serif';g.fillText('Observed air wavelength (Å)',left+pw/2,h-7);
  g.save();g.translate(13,top+ph/2);g.rotate(-Math.PI/2);g.fillText('Σ signal (native units)',0,0);g.restore();
  if(val){
   g.save();g.beginPath();g.rect(left,top,pw,ph);g.clip();g.strokeStyle=locked?'#a57224':'#2c775b';g.lineWidth=1.5;g.beginPath();let started=false;
   for(let k=0;k<val.length;k++){if(!Number.isFinite(val[k])){started=false;continue;}const x=X(meta.wavelength0+k*meta.wavelengthStep),y=Y(val[k]);if(!started){g.moveTo(x,y);started=true;}else{const half=meta.wavelengthStep/(xmax-xmin)*pw/2;g.lineTo(x-half,Y(val[k-1]));g.lineTo(x-half,y);g.lineTo(x,y);}}
   g.stroke();g.restore();
  }else{g.fillStyle='#526b60';g.font='13px -apple-system, sans-serif';g.textAlign='center';g.fillText(w<450?'Move or tap on the coloured nebula':'Move over the coloured nebula to inspect its spectrum',left+pw/2,top+ph/2);}
  if(graphHover!==null&&val){const k=graphHover,x=X(meta.wavelength0+k*meta.wavelengthStep);g.setLineDash([3,3]);g.strokeStyle='#738a7b';g.beginPath();g.moveTo(x,top);g.lineTo(x,h-bottom);g.stroke();g.setLineDash([]);if(Number.isFinite(val[k])){g.beginPath();g.arc(x,Y(val[k]),3,0,Math.PI*2);g.fillStyle='#2c775b';g.fill();}}
 }
 function setPosition(x,y){
  x=Math.floor(x);y=Math.floor(y);
  const inside=x>=0&&x<meta.width&&y>=0&&y<meta.height&&footprint[y*meta.width+x]===1;
  hovered=inside;
  if(!inside){selection=null;spectrum=null;$('spectrum-title').textContent='Move onto the coloured nebula';$('spectrum-info').textContent='No spectrum displayed outside the mask footprint.';$('position').textContent='Outside nebula footprint';$('sky').textContent='North up · East left';}
  else if(!selection||selection.x!==x||selection.y!==y){selection={x,y};extract();}
  drawField();drawGraph();
 }
 function pointerPosition(event){const r=field.getBoundingClientRect();return {x:camera.x+(event.clientX-r.left)/r.width*camera.w,y:meta.height-1-Math.floor(camera.y+(event.clientY-r.top)/r.height*camera.h)};}
 field.addEventListener('pointermove',e=>{if(!ready||locked||e.pointerType==='touch')return;const p=pointerPosition(e);setPosition(p.x,p.y);});
 field.addEventListener('click',e=>{if(!ready)return;if(locked){unlock();return;}const p=pointerPosition(e);setPosition(p.x,p.y);if(selection){locked=true;$('release').disabled=false;$('status').textContent='Selection locked';extract();drawField();drawGraph();}});
 function unlock(){locked=false;$('release').disabled=true;$('status').textContent='Move or tap on the nebula';if(selection)extract();drawField();drawGraph();}
 $('release').addEventListener('click',unlock);
 field.addEventListener('keydown',e=>{if(!ready)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();if(locked)unlock();else if(selection){locked=true;$('release').disabled=false;$('status').textContent='Selection locked';extract();drawField();drawGraph();}return;}const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!moves[e.key])return;e.preventDefault();if(locked)return;const p=selection||meta.initialPosition,[dx,dy]=moves[e.key];let x=p.x+dx,y=p.y+dy;for(let i=0;i<100;i++,x+=dx,y+=dy){if(x<0||y<0||x>=meta.width||y>=meta.height)break;if(footprint[y*meta.width+x]){setPosition(x,y);break;}}});
 function setZoom(value){zoom=value;$('view-nebula').classList.toggle('selected',zoom>1);$('view-field').classList.toggle('selected',zoom===1);$('view-nebula').setAttribute('aria-pressed',String(zoom>1));$('view-field').setAttribute('aria-pressed',String(zoom===1));drawField();}
 $('view-nebula').addEventListener('click',()=>setZoom(2.6));$('view-field').addEventListener('click',()=>setZoom(1));
 $('opacity').addEventListener('input',e=>{opacity=Number(e.target.value)/100;$('opacity-value').textContent=e.target.value+'%';drawField();});
 $('aperture').addEventListener('change',e=>{radius=Number(e.target.value);if(ready){extract();drawField();drawGraph();}});
 graph.addEventListener('pointermove',e=>{if(!ready||!spectrum||!geometry)return;const r=graph.getBoundingClientRect(),x=e.clientX-r.left;graphHover=Math.max(0,Math.min(meta.channels-1,channelOf(geometry.xmin+(x-geometry.left)/geometry.pw*(geometry.xmax-geometry.xmin))));const v=spectrum.values[graphHover];$('spectral-cursor').textContent=`λ ${(meta.wavelength0+graphHover*meta.wavelengthStep).toFixed(2)} Å · Σ ${Number.isFinite(v)?numeric(v):'missing'} native units`;drawGraph();});
 graph.addEventListener('pointerleave',()=>{graphHover=null;$('spectral-cursor').textContent='Observed wavelength · air';drawGraph();});
 new ResizeObserver(()=>{drawField();drawGraph();}).observe($('explorer'));
 function channelOf(wave){return Math.max(0,Math.min(meta.channels-1,Math.round((Number(wave)-meta.wavelength0)/meta.wavelengthStep)));}
 function setWindow(lo,hi){
  if(!ready)return;
  windowLow=Math.max(0,Math.min(meta.channels-1,Math.min(lo,hi)));windowHigh=Math.max(windowLow,Math.min(meta.channels-1,Math.max(lo,hi)));
  $('channel-min').value=windowLow;$('channel-max').value=windowHigh;
  const a=meta.wavelength0+windowLow*meta.wavelengthStep,b=meta.wavelength0+windowHigh*meta.wavelengthStep;
  $('wave-min').value=a.toFixed(2);$('wave-max').value=b.toFixed(2);
  $('window-info').textContent=`Image: ${a.toFixed(2)}–${b.toFixed(2)} Å · ${windowHigh-windowLow+1} channels`;
  updateNebula();drawField();drawGraph();
 }
 function updateNebula(){
  const c=meta.crop,n=meta.channels,total=c.width*c.height,signal=new Float64Array(total),weight=new Float64Array(total);
  for(let pixel=0;pixel<total;pixel++)for(let k=windowLow;k<=windowHigh;k++){
   const index=pixel*n+k;
   if(maskBits[index>>3]&(1<<(index&7))){weight[pixel]=1;const v=spectra[index];if(Number.isFinite(v))signal[pixel]+=v;}
  }
  // Mask-normalized separable Gaussian, for display only. Spectra stay untouched.
  const kernel=Array.from({length:9},(_,i)=>Math.exp(-((i-4)**2)/(2*1.2**2)));
  const blur=input=>{let a=new Float64Array(total),b=new Float64Array(total);
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let sum=0;for(let d=-4;d<=4;d++)if(x+d>=0&&x+d<c.width)sum+=input[y*c.width+x+d]*kernel[d+4];a[y*c.width+x]=sum;}
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let sum=0;for(let d=-4;d<=4;d++)if(y+d>=0&&y+d<c.height)sum+=a[(y+d)*c.width+x]*kernel[d+4];b[y*c.width+x]=sum;}return b;};
  const smooth=blur(signal),norm=blur(weight),canvas=document.createElement('canvas');canvas.width=meta.width;canvas.height=meta.height;
  const cc=canvas.getContext('2d'),im=cc.createImageData(meta.width,meta.height),colours=[[55,8,43],[132,20,49],[217,56,34],[250,133,35],[255,213,106],[255,249,219]];
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
   const i=y*c.width+x;if(!weight[i])continue;
   let t=Math.max(0,Math.min(1,(smooth[i]/Math.max(norm[i],1e-12)-meta.displayLow)/Math.max(meta.displayHigh-meta.displayLow,1e-12)));
   t=Math.asinh(8*t)/Math.asinh(8);const pos=t*5,j=Math.min(4,Math.floor(pos)),f=pos-j;
   const offset=((meta.height-1-(y+c.y0))*meta.width+x+c.x0)*4;
   for(let v=0;v<3;v++)im.data[offset+v]=Math.round(colours[j][v]*(1-f)+colours[j+1][v]*f);
   im.data[offset+3]=Math.round(95+155*t);
  }
  cc.putImageData(im,0,0);nebula=canvas;
 }
 $('channel-min').addEventListener('input',e=>{if(ready)setWindow(Math.min(Number(e.target.value),windowHigh),windowHigh);});
 $('channel-max').addEventListener('input',e=>{if(ready)setWindow(windowLow,Math.max(Number(e.target.value),windowLow));});
 function applyWindow(){if(!ready)return;const a=Number($('wave-min').value),b=Number($('wave-max').value);if(!Number.isFinite(a)||!Number.isFinite(b))return;setWindow(channelOf(a),channelOf(b));}
 $('apply-window').addEventListener('click',applyWindow);
 for(const id of ['wave-min','wave-max'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')applyWindow();});
 $('reset-window').addEventListener('click',()=>{if(ready)setWindow(...meta.maskChannels);});
 function graphChannel(event){const r=graph.getBoundingClientRect();return Math.max(0,Math.min(meta.channels-1,channelOf(geometry.xmin+(event.clientX-r.left-geometry.left)/geometry.pw*(geometry.xmax-geometry.xmin))));}
 graph.addEventListener('pointerdown',e=>{if(!ready||!geometry)return;const r=graph.getBoundingClientRect(),x=e.clientX-r.left;if(x<geometry.left||x>geometry.left+geometry.pw)return;dragStart=graphChannel(e);graph.setPointerCapture(e.pointerId);});
 graph.addEventListener('pointermove',e=>{if(dragStart!==null)setWindow(dragStart,graphChannel(e));});
 graph.addEventListener('pointerup',e=>{if(dragStart===null)return;const end=graphChannel(e);if(end!==dragStart)setWindow(dragStart,end);dragStart=null;});
 graph.addEventListener('pointercancel',()=>{dragStart=null;});
 graph.addEventListener('keydown',e=>{if(!ready)return;const delta=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0;if(!delta)return;e.preventDefault();if(e.shiftKey)setWindow(windowLow,Math.max(windowLow,windowHigh+delta));else setWindow(Math.max(0,Math.min(meta.channels-1,windowLow+delta)),windowHigh);});
 $('spectrum-view').addEventListener('click',()=>{if(!ready)return;lineView=!lineView;graphHover=null;$('spectrum-view').textContent=lineView?'Full spectrum':'Line view';drawGraph();});
 $('observation').addEventListener('change',e=>loadObservation(e.target.value));
 const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
 const check=async(url,kind)=>{const response=await fetch(url);if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return kind==='json'?response.json():response.arrayBuffer();};
 async function loadObservation(id){
  const version=++loadVersion;lineView=true;$('spectrum-view').textContent='Full spectrum';ready=false;locked=false;selection=null;spectrum=null;graphHover=null;dragStart=null;
  $('release').disabled=true;$('loading').hidden=false;$('explorer').setAttribute('aria-busy','true');$('status').textContent=`Loading ${id}…`;
  $('loading').querySelector('span').textContent=`Loading ${id}`;$('load-detail').textContent=`${catalog.find(x=>x.id===id)?.megabytes||''} MB · real spectra and 3-D mask`;
  // Remove the previous observation immediately, including its coordinate readouts.
  ctx.clearRect(0,0,field.width,field.height);g.clearRect(0,0,graph.width,graph.height);$('position').textContent='Loading…';$('sky').textContent='';$('spectrum-title').textContent='Loading observation…';$('spectrum-info').textContent='';$('line-limits').textContent='';$('window-info').textContent='';
  try{
   const embedded=window.MUSE_EMBEDDED?.observations[id],base=`muse-data/${id}-`;
   const [m,bin,fp,bits,bg]=embedded?await Promise.all([embedded.metadata,decode(embedded.spectra),decode(embedded.footprint),decode(embedded.mask),image(embedded.field)]):await Promise.all([check(base+'metadata.json','json'),(async()=>{const info=await check(base+'metadata.json','json');const pieces=await Promise.all(info.parts.map(part=>check('muse-data/'+part,'binary')));const joined=new Uint8Array(pieces.reduce((n,b)=>n+b.byteLength,0));let at=0;for(const piece of pieces){joined.set(new Uint8Array(piece),at);at+=piece.byteLength;}return joined.buffer;})(),check(base+'footprint.u8','binary'),check(base+'mask.bits','binary'),image(base+'field.png')]);
   if(version!==loadVersion)return;
   meta=m;spectra=new Float32Array(bin);footprint=new Uint8Array(fp);maskBits=new Uint8Array(bits);background=bg;currentId=id;
   field.setAttribute('aria-label',`MUSE field of ${id} with masked nebula. Move or tap on the nebula; arrow keys move the selection, Enter locks it.`);
   if(spectra.length!==meta.crop.width*meta.crop.height*meta.channels||footprint.length!==meta.width*meta.height||maskBits.length!==Math.ceil(spectra.length/8))throw new Error('Payload size mismatch');
   for(const control of ['channel-min','channel-max']){$(control).min=0;$(control).max=meta.channels-1;$(control).step=1;}
   for(const control of ['wave-min','wave-max']){$(control).min=meta.wavelength0.toFixed(2);$(control).max=(meta.wavelength0+(meta.channels-1)*meta.wavelengthStep).toFixed(2);$(control).step='any';}
   $('line-limits').textContent=`Nebula line limits: ${meta.maskWavelength[0].toFixed(2)}–${meta.maskWavelength[1].toFixed(2)} Å (air) · always shown in green`;
   $('source-files').textContent='Inputs: '+meta.sourceFiles.join('; ');
   ready=true;selection={...meta.initialPosition};extract();setWindow(...meta.maskChannels);$('loading').hidden=true;$('explorer').setAttribute('aria-busy','false');$('status').textContent='Move or tap on the nebula';
  }catch(error){if(version!==loadVersion)return;$('status').textContent='Observation unavailable';$('loading').querySelector('span').textContent='The observation could not be loaded.';$('load-detail').textContent=error.message;$('explorer').setAttribute('aria-busy','false');console.error(error);}
 }
 async function start(){try{
  catalog=window.MUSE_EMBEDDED?.catalog||await check('muse-data/catalog.json','json');
  $('observation').replaceChildren(...catalog.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;return option;}));
  await loadObservation(catalog[0].id);
 }catch(error){$('status').textContent='Fields unavailable';$('load-detail').textContent=error.message;}}
 const loaderButton=document.createElement('button');loaderButton.className='start-observation';loaderButton.textContent='Explore the observations';$('loading').querySelector('span').textContent='Three quasar fields. Real MUSE data.';$('loading').append(loaderButton);$('status').textContent='Ready to explore';$('explorer').setAttribute('aria-busy','false');
 loaderButton.addEventListener('click',()=>{loaderButton.remove();start();},{once:true});
})();
