/* 도장만들기 프로그램의 개인 인감 렌더러에서 가져옴.
MIT License

Copyright (c) 2026 남궁연 (Namgung Yeon)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const FONTS = [{ fam: "Song Myung", w: 400 }];
function mulberry32(a){
  return function(){
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function smoothstep(a,b,x){
  if(b<=a) return x<a?0:1;
  let t=(x-a)/(b-a);
  t = t<0?0:t>1?1:t;
  return t*t*(3-2*t);
}
/* 격자 난수 + 부드러운 보간으로 만든 프랙탈 노이즈 (fBm) */
function makeNoise(seed){
  const P=256, MASK=255;
  const rnd=mulberry32(seed|0);
  const g=new Float32Array(P*P);
  for(let i=0;i<g.length;i++) g[i]=rnd();
  function v(ix,iy){ return g[((iy&MASK)<<8) + (ix&MASK)]; }
  function n2(x,y){
    const x0=Math.floor(x), y0=Math.floor(y);
    const tx=x-x0, ty=y-y0;
    const fx=tx*tx*(3-2*tx), fy=ty*ty*(3-2*ty);
    const a=v(x0,y0), b=v(x0+1,y0), c=v(x0,y0+1), d=v(x0+1,y0+1);
    return (a+(b-a)*fx) + ((c+(d-c)*fx) - (a+(b-a)*fx))*fy;
  }
  return function fbm(x,y){
    let amp=0.5, f=1, sum=0, norm=0;
    for(let o=0;o<4;o++){ sum+=amp*n2(x*f,y*f); norm+=amp; amp*=0.5; f*=2.13; }
    return sum/norm;
  };
}
/* 큰 이미지에서 픽셀마다 fBm을 부르면 느리므로, 절반 해상도 필드를 만들어 두고 보간해 쓴다 */
function buildField(size, seed, freq){
  const q=2;
  const W=Math.ceil(size/q)+2;
  const f=new Float32Array(W*W);
  const fbm=makeNoise(seed);
  for(let y=0;y<W;y++){
    for(let x=0;x<W;x++) f[y*W+x]=fbm(x*q*freq, y*q*freq);
  }
  return {f,W,q};
}
function sampleField(F,x,y){
  const fx=x/F.q, fy=y/F.q;
  const x0=fx|0, y0=fy|0;
  const tx=fx-x0, ty=fy-y0;
  const i=y0*F.W+x0;
  const a=F.f[i], b=F.f[i+1], c=F.f[i+F.W], d=F.f[i+F.W+1];
  const top=a+(b-a)*tx, bot=c+(d-c)*tx;
  return top+(bot-top)*ty;
}

/* ============================================================
   도형
   ============================================================ */
/* 초타원 지수: 원=2, 둥근사각=4.2, 사각=12 */
function shapeExp(shape){
  return shape==='square' ? 12 : shape==='rounded' ? 4.2 : 2;
}
function shapeRadii(shape, R){
  return shape==='ellipse' ? {rx:R, ry:R*0.74} : {rx:R, ry:R};
}
/* 각도 a 에서의 초타원 반지름. 큰 지수에서도 값이 넘치지 않도록 최댓값으로 정규화해 계산한다. */
function outlineR(a, rx, ry, n){
  const u=Math.abs(Math.cos(a))/rx, v=Math.abs(Math.sin(a))/ry;
  const m=Math.max(u,v);
  if(m<=0) return rx;
  const s=Math.pow(Math.pow(u/m,n)+Math.pow(v/m,n), 1/n);
  return 1/(m*s);
}
/* 테두리를 미세하게 떨리게 만든 폴리곤 경로. scale<1 이면 안쪽 윤곽. */
function outlinePath(ctx, rx, ry, n, rough, fbm, phase, ampBase){
  const N = 1080;
  ctx.beginPath();
  for(let i=0;i<=N;i++){
    const a = i/N*Math.PI*2;
    const ca=Math.cos(a), sa=Math.sin(a);
    let r = outlineR(a, rx, ry, n);
    if(rough>0){
      // 저주파(전체가 살짝 찌그러짐) + 고주파(손으로 새긴 미세한 떨림)
      const lo = fbm(ca*1.7+phase, sa*1.7+phase) - 0.5;
      const hi = fbm(ca*8.5+phase*2.3, sa*8.5+phase*2.3) - 0.5;
      r += (lo*1.0 + hi*0.5) * rough * ampBase;
    }
    const x=ca*r, y=sa*r;
    if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
  }
  ctx.closePath();
}

/* ============================================================
   글자 배치
   ============================================================ */
function layoutCells(n, mode){
  let cols;
  if(mode==='horizontal') cols=n;
  else if(mode==='vertical') cols=1;
  else if(mode==='grid') cols=Math.ceil(Math.sqrt(n));
  else { // auto
    if(n<=3) cols=1;
    else if(n<=6) cols=2;
    else if(n<=9) cols=3;
    else cols=Math.ceil(Math.sqrt(n));
  }
  cols=Math.max(1, Math.min(cols, n));
  const base=Math.floor(n/cols), extra=n%cols;
  const counts=[];
  for(let c=0;c<cols;c++) counts.push(base+(c<extra?1:0));
  return {cols, counts};
}
/* 가로:세로 비율이 A 인 직사각형을 초타원 안에 최대로 넣었을 때의 세로 반크기 */
function inscribedHalfHeight(A, rx, ry, n){
  const u=A/rx, v=1/ry;
  const m=Math.max(u,v);
  const s=Math.pow(Math.pow(u/m,n)+Math.pow(v/m,n), 1/n);
  return 1/(m*s);
}
/* 글자 하나의 실측 정보. 상자 크기(gw,gh)와 상자 중심이 기준선 원점에서 벗어난 양(gx,gy) */
function glyphBox(m){
  return {
    gw: Math.max(1, (m.actualBoundingBoxRight||0)+(m.actualBoundingBoxLeft||0) || m.width),
    gh: Math.max(1, (m.actualBoundingBoxAscent||REF*0.72)+(m.actualBoundingBoxDescent||0)),
    gx: ((m.actualBoundingBoxRight||0)-(m.actualBoundingBoxLeft||0))/2,
    gy: ((m.actualBoundingBoxAscent||REF*0.72)-(m.actualBoundingBoxDescent||0))/2,
  };
}
/* 칸마다 글자를 얼마나 늘릴지(sx,sy). 그릴 때와 글자판 크기를 정할 때 같은 계산을 써야 하므로 함수로 뺐다. */
function glyphScales(boxes, cells, gap, fill, stretch){
  const each=boxes.map((b,i)=>({ sx:(cells[i].w-gap)*fill/b.gw, sy:(cells[i].h-gap)*fill/b.gh }));
  if(!stretch){
    // 원래 비율 모드에서는 모든 글자에 같은 배율을 적용한다.
    // 글자마다 다른 실제 획 폭을 같은 너비로 늘리면 명조·붓글씨가 흐트러진다.
    const u=Math.min(...each.map(e=>Math.min(e.sx,e.sy)));
    return each.map(()=>({sx:u, sy:u}));
  }
  // 칸을 채우되 장평이 과하게 일그러지지 않도록 가로:세로 비율을 제한한다
  const AR=1.35;
  return each.map(({sx,sy})=>{
    if(sx > sy*AR) sx = sy*AR;
    if(sy > sx*AR) sy = sx*AR;
    return {sx,sy};
  });
}

/* 글자의 실제 잉크가 어디에 있는지 표본점으로 뽑아 둔다 (상자 중심 기준, REF 폰트 단위).
   상자 모서리가 비어 있는 글자(ㅇ, 金 …)를 사각형으로 보면 테두리 가까이 넣을 수 없으므로,
   글자판 크기를 정할 때 실제 획 모양을 본다. 글씨체·글자별로 한 번만 만들고 재사용한다. */
const GLYPH_SAMPLES=new Map();
let sampleCanvas=null;
function glyphSamples(f, ch, box){
  const key=f.fam+'|'+f.w+'|'+ch;
  let smp=GLYPH_SAMPLES.get(key);
  if(smp) return smp;
  const N=48;
  if(!sampleCanvas){ sampleCanvas=document.createElement('canvas'); sampleCanvas.width=sampleCanvas.height=N; }
  const c=sampleCanvas.getContext('2d',{willReadFrequently:true});
  const k=(N-4)/Math.max(box.gw, box.gh);
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,N,N);
  c.fillStyle='#000';
  c.font=fontSpec(f, REF); c.textAlign='center'; c.textBaseline='alphabetic';
  c.setTransform(k,0,0,k,N/2,N/2);
  c.fillText(ch, -box.gx, box.gy);
  const d=c.getImageData(0,0,N,N).data;
  const pts=[];
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    if(d[(j*N+i)*4+3]>96) pts.push((i+0.5-N/2)/k, (j+0.5-N/2)/k);
  }
  smp=new Float32Array(pts);
  if(smp.length) GLYPH_SAMPLES.set(key, smp);   // 아직 폰트가 안 떠서 빈 결과면 다음에 다시
  return smp;
}

/* 글자판(사각형)의 세로 반크기를 정한다.
   내접 사각형만 쓰면 원형 도장에서 글자가 지름의 71%까지밖에 못 커진다.
   실제 도장처럼 글자를 테두리 가까이 붙이되, 각 글자의 잉크 가운데 윤곽 밖으로 나가는 양이
   OVERLAP_FRAC 이하이고 가장 깊이 나가는 획도 글자 크기의 OVERLAP_DEPTH 배를 넘지 않는 최대 크기를 찾는다.
   안쪽 윤곽을 넘는 획도 자르지 않고 테두리와 자연스럽게 겹쳐 그린다. */
const OVERLAP_FRAC = 0.04;    // 안쪽 윤곽과 겹칠 수 있는 잉크 비율
const OVERLAP_DEPTH = 0.10;   // 획이 윤곽 밖으로 나가도 되는 최대 깊이 (글자 크기 대비)
function fitBlockHalfHeight(f, all, boxes, grid, trad, riX, riY, nExp, fill, spacing, stretch){
  const rowsMax=Math.max(...grid.counts), cols=grid.cols;
  const A=cols/rowsMax;
  const base=inscribedHalfHeight(A, riX, riY, nExp);
  const samples=all.map((ch,i)=>glyphSamples(f, ch, boxes[i]));
  if(samples.some(s=>!s.length)) return base;            // 측정 실패 — 내접 사각형으로
  const fits = halfH => {
    const boxH=2*halfH, boxW=boxH*A;
    const cells=buildCells(grid, trad, boxW, boxH);
    const gap=Math.min(boxW/cols, boxH/rowsMax)*spacing/100;
    const sc=glyphScales(boxes, cells, gap, fill, stretch);
    for(let i=0;i<all.length;i++){
      const {cx,cy}=cells[i], {sx,sy}=sc[i], s=samples[i];
      const size=Math.max(boxes[i].gw*sx, boxes[i].gh*sy);
      let out=0;
      const total=s.length/2, maxOut=total*OVERLAP_FRAC, maxDepth=size*OVERLAP_DEPTH;
      for(let k=0;k<s.length;k+=2){
        const X=cx+s[k]*sx, Y=cy+s[k+1]*sy;
        const q=Math.pow(Math.pow(Math.abs(X)/riX,nExp)+Math.pow(Math.abs(Y)/riY,nExp), 1/nExp);
        if(q<=1) continue;
        if(++out>maxOut) return false;
        if(Math.hypot(X,Y)*(1-1/q) > maxDepth) return false;   // 윤곽에서 밖으로 나간 거리
      }
    }
    return true;
  };
  let lo=0, hi=base*2;
  for(let i=0;i<28;i++){ const mid=(lo+hi)/2; if(fits(mid)) lo=mid; else hi=mid; }
  return lo;
}
/* 글자를 채울 순서대로 칸(중심좌표+크기) 목록을 만든다 */
function buildCells(grid, trad, boxW, boxH){
  const {cols, counts}=grid;
  const cw=boxW/cols;
  // 칸 높이는 가장 긴 열을 기준으로 통일하고, 짧은 열은 위아래 가운데로 모은다.
  // (열마다 높이를 다르게 하면 글자 크기가 들쭉날쭉해진다)
  const ch=boxH/Math.max(...counts);
  const cells=[];
  for(let c=0;c<cols;c++){
    const colPos = trad ? (cols-1-c) : c;
    const cx = -boxW/2 + cw*(colPos+0.5);
    const rows=counts[c];
    const colH=ch*rows;
    for(let r=0;r<rows;r++){
      cells.push({ cx, cy:-colH/2 + ch*(r+0.5), w:cw, h:ch });
    }
  }
  return cells;
}

/* ============================================================
   전체 렌더
   ============================================================ */
const REF = 220; // 글자 측정용 기준 폰트 크기

function fontSpec(f, px){ return `${f.w} ${px}px "${f.fam}", serif`; }

async function ensureFont(f, sample){
  try{
    await document.fonts.load(fontSpec(f, 100), sample || '가');
    await document.fonts.load(fontSpec(f, REF), sample || '가');
  }catch(e){ /* CDN 차단 등 — 대체 글씨체로 그린다 */ }
}

/* 회전된 윤곽과 최대 요철을 캔버스 안에 두어 모서리 잘림을 막는다. */
function stampRadius(size, shape, rotation, rough){
  const {rx,ry}=shapeRadii(shape,1), exponent=shapeExp(shape);
  const turn=rotation*Math.PI/180;
  let extent=1;
  for(let i=0;i<720;i++){
    const a=i*Math.PI*2/720, r=outlineR(a,rx,ry,exponent);
    extent=Math.max(extent,Math.abs(r*Math.cos(a+turn)),Math.abs(r*Math.sin(a+turn)));
  }
  return size*0.455/(extent+rough/100*0.0675);
}

function render(ctx, size, st){
  const f = FONTS[st.fontIdx] || FONTS[0];
  const chars = [...st.text.trim()].filter(c=>c!==' ');
  const all = chars.concat([...st.suffix]);
  const n = all.length;

  ctx.clearRect(0,0,size,size);
  ctx.save();
  ctx.translate(size/2, size/2);
  ctx.rotate(st.rot*Math.PI/180);

  const R = stampRadius(size, st.shape, st.rot, st.rough);
  const {rx, ry} = shapeRadii(st.shape, R);
  const nExp = shapeExp(st.shape);
  const rough = st.rough/100;
  const fbm = makeNoise(st.seed ^ 0x9e37);
  const roughAmp = R*0.09;

  const bw = R * (st.border/1000);          // 테두리 두께 (0 ~ 0.14R)
  const padIn = R * (st.pad/1000);          // 안쪽 여백

  /* ---- 테두리 / 바탕 ---- */
  ctx.fillStyle = st.color;
  ctx.strokeStyle = st.color;
  ctx.lineJoin='round';

  if(st.style==='eum'){
    // 음각: 도형을 붉게 채우고, 글자는 나중에 파낸다
    outlinePath(ctx, rx, ry, nExp, rough, fbm, 3.1, roughAmp);
    ctx.fill();
    if(bw > R*0.012){
      // 바탕 안쪽에 테두리 선을 파내 전통 관인 느낌을 준다
      const inset = bw*1.9;
      ctx.save();
      ctx.globalCompositeOperation='destination-out';
      ctx.lineWidth = bw*0.55;
      outlinePath(ctx, rx-inset, ry-inset, nExp, rough, fbm, 3.1, roughAmp*0.8);
      ctx.stroke();
      ctx.restore();
    }
  }else if(bw > 0.5){
    // 양각: 테두리 선만 그린다
    ctx.lineWidth = bw;
    outlinePath(ctx, rx-bw/2, ry-bw/2, nExp, rough, fbm, 3.1, roughAmp);
    ctx.stroke();
  }

  // 바깥 선보다 가늘게, 선 사이에는 일정한 여백을 둔다.
  const doubleInset=st.doubleBorder && st.style==='yang' && bw>0.5 ? bw*2.15 : 0;
  if(doubleInset){
    ctx.lineWidth=bw*0.38;
    outlinePath(ctx, rx-doubleInset, ry-doubleInset, nExp, rough, fbm, 3.1, roughAmp*0.8);
    ctx.stroke();
  }

  /* ---- 안쪽 여유 반지름 ---- */
  const frameInset=doubleInset ? doubleInset+bw*0.19 : bw;
  let riX = rx - frameInset - padIn;
  let riY = ry - frameInset - padIn;
  if(st.style==='eum'){ riX -= bw*1.4; riY -= bw*1.4; }

  /* ---- 글자 ---- */
  if(n>0 && riX>4 && riY>4){
    ctx.save();
    ctx.fillStyle = st.color;
    ctx.font = fontSpec(f, REF);
    ctx.textAlign='center';
    ctx.textBaseline='alphabetic';
    const boxes=all.map(ch=>glyphBox(ctx.measureText(ch)));

    // 칸이 정사각형에 가까워지도록 글자판 비율을 정하고, 실제 획 모양이 허용하는 만큼 테두리 가까이 키운다
    const grid = layoutCells(n, st.layout);
    const rowsMax = Math.max(...grid.counts);
    const A = grid.cols/rowsMax;
    const fill = st.glyphFill/100;
    const halfH = fitBlockHalfHeight(f, all, boxes, grid, st.trad, riX, riY, nExp, fill, st.spacing || 0, st.stretch);
    const boxH = 2*halfH;
    const boxW = boxH*A;
    const cells = buildCells(grid, st.trad, boxW, boxH);
    const gap=Math.min(boxW/grid.cols, boxH/rowsMax)*(st.spacing || 0)/100;
    const scales=glyphScales(boxes, cells, gap, fill, st.stretch);

    // 테두리와 겹치더라도 글자의 획 전체를 그린다.
    if(st.style==='eum') ctx.globalCompositeOperation='destination-out';

    for(let i=0;i<n && i<cells.length;i++){
      const cell=cells[i], b=boxes[i], {sx,sy}=scales[i];
      ctx.save();
      ctx.translate(cell.cx, cell.cy);
      ctx.scale(sx, sy);
      ctx.fillText(all[i], -b.gx, b.gy);
      ctx.restore();
    }
    ctx.restore();
  }

  ctx.restore();

  /* ---- 잉크 번짐·끊김 ---- */
  if(st.ink>0) applyInk(ctx, size, st);
}

/* 잉크가 고르게 묻지 않은 느낌: 획 경계부터 벗겨지고, 넓은 면은 얼룩진다 */
function applyInk(ctx, size, st){
  const img = ctx.getImageData(0,0,size,size);
  const d = img.data;
  const N = size*size;

  const A = new Float32Array(N);
  let any=false;
  for(let i=0;i<N;i++){ const a=d[i*4+3]/255; A[i]=a; if(a>0) any=true; }
  if(!any) return;

  const amt = (st.ink/100)*0.78;                        // 끊김 강도
  const gr  = st.grain/100;
  // 얼룩 크기는 1024px 기준으로 정하고, 해상도가 달라도 같은 모습이 되도록 반비례로 맞춘다
  const freqBreak = (0.005 + gr*0.032) * (1024/size);
  const freqSoft  = freqBreak*0.32;
  const Fb = buildField(size, st.seed*7919+13, freqBreak);
  const Fs = buildField(size, st.seed*104729+7, freqSoft);

  const step = Math.max(2, Math.round(size*0.006));     // 경계 판정 간격 (도장 크기에 비례)
  const soft = 0.11;

  for(let y=0;y<size;y++){
    const row=y*size;
    for(let x=0;x<size;x++){
      const i=row+x;
      const a0=A[i];
      if(a0<=0) continue;

      // 주변 알파 평균 → 1에 가까우면 획 내부, 작으면 경계
      const xm=x>step?x-step:0, xp=x+step<size?x+step:size-1;
      const ym=y>step?y-step:0, yp=y+step<size?y+step:size-1;
      const cov=(A[row+xm]+A[row+xp]+A[ym*size+x]+A[yp*size+x])*0.25;
      const edge=1-Math.min(1,cov);

      const nb=sampleField(Fb,x,y);
      const ns=sampleField(Fs,x,y);

      // 경계일수록 문턱이 높아져 먼저 벗겨진다
      const th = amt*(0.5 + 1.05*edge);
      const keep = smoothstep(th-soft, th+soft, nb);

      // 남은 부분도 농담 차이가 생긴다. fBm 은 값이 중앙에 몰리므로 폭을 넓혀 대비를 살린다.
      const nsw = smoothstep(0.32, 0.68, ns);
      const dens = 1 - (st.ink/100)*0.45*(1-nsw);

      const a = a0*keep*dens;
      d[i*4+3] = a<=0 ? 0 : a>=1 ? 255 : (a*255)|0;
    }
  }
  ctx.putImageData(img,0,0);
}


export const PERSONAL_STAMP_DEFAULTS = Object.freeze({
  suffix: '인', fontIdx: 0, shape: 'circle', style: 'yang', layout: 'auto',
  trad: true, stretch: true, glyphFill: 96, spacing: 0, doubleBorder: false,
  color: '#b3272d', border: 52, pad: 40, rot: 0,
  ink: 16, grain: 62, rough: 14, seed: 20260730,
});
export async function loadStampFont(name) {
  await ensureFont(FONTS[0], name + '인印');
}
/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} name
 * @param {string} [suffix]
 * @param {'yang'|'eum'} [style]
 * @param {Partial<typeof PERSONAL_STAMP_DEFAULTS>} [overrides] 마모(ink)·테두리 떨림(rough)·seed 등 기본값 덮어쓰기
 */
export function drawPersonalStamp(canvas, name, suffix = '인', style = 'yang', overrides = {}) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  render(ctx, canvas.width, { ...PERSONAL_STAMP_DEFAULTS, ...overrides, text: name, suffix, style });
}
