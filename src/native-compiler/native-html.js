import {compileNativeProject} from './compiler';

const safe = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Generate a standalone HTML document with no Scratch Player, Scratch VM,
 * scaffolding, or remote runtime dependency. The emitted code is project
 * specific; it contains only the compiled scripts and the tiny canvas host.
 */
export const createNativeHTML = (project, title = 'Scratch project') => {
  const compiled = compileNativeProject(project);
  const source = `
(() => {
  const project = ${safe(compiled)};
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const input = {mouseX:0,mouseY:0,mouseDown:false,keys:new Set()};
  const normalizeKey = key => ({' ':'space','arrowup':'up','arrowdown':'down','arrowleft':'left','arrowright':'right'}[String(key).toLowerCase()] || String(key).toLowerCase());
  const sprites = project.sprites.filter(s => !s.isStage).map((s,i) => ({
    ...s, x:s.x, y:s.y, direction:s.direction, visible:s.visible, bubble:'', bubbleUntil:0, running:true, id:i, variables:{...(s.variables||{})},
    images:(s.costumes || []).map(costume => {
      const encoded=project.assets[costume.asset];
      if(!encoded)return null;
      const ext=(costume.asset.split('.').pop()||'png').toLowerCase();
      const mime=ext==='svg'?'image/svg+xml':ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/png';
      const image=new Image();image.src='data:'+mime+';base64,'+encoded;
      return {image,costume};
    }).filter(Boolean), costumeIndex:0
  }));
  const stage = project.sprites.find(s => s.isStage) || {name:'Stage', scripts:[]};
  stage.running = true;
  const globalVariables = {...(stage.variables || {})};
  stage.variables = globalVariables;
  stage.images = (stage.costumes || []).map(costume => {
    const encoded=project.assets[costume.asset];
    if(!encoded)return null;
    const ext=(costume.asset.split('.').pop()||'png').toLowerCase();
    const mime=ext==='svg'?'image/svg+xml':ext==='jpg'||ext==='jpeg'?'image/jpeg':'image/png';
    const image=new Image();image.src='data:'+mime+';base64,'+encoded;
    return image;
  }).filter(Boolean);
  let running = true;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0,ms)));
  const apiFor = sprite => ({
    sprite, get direction(){return sprite.direction;}, set direction(v){sprite.direction=v;},
    get running(){return running && sprite.running;},
    stopAll(){running=false;},
    stopSprite(){sprite.running=false;},
    setX(x){sprite.x=Number(x)||0;}, setY(y){sprite.y=Number(y)||0;},
    goto(x,y){sprite.x=Number(x)||0;sprite.y=Number(y)||0;},
    turn(d){sprite.direction=(sprite.direction+(Number(d)||0))%360;},
    async move(steps){const a=sprite.direction*Math.PI/180;sprite.x+=Math.sin(a)*Number(steps);sprite.y+=Math.cos(a)*Number(steps);await this.yield();},
    glide(seconds,x,y){const duration=Math.max(0,Number(seconds)||0)*1000,sx=sprite.x,sy=sprite.y,tx=Number(x)||0,ty=Number(y)||0,start=performance.now();return new Promise(resolve=>{const frame=now=>{const t=duration?Math.min(1,(now-start)/duration):1;sprite.x=sx+(tx-sx)*t;sprite.y=sy+(ty-sy)*t;if(t<1)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});},
    bounce(){let dx=Math.sin(sprite.direction*Math.PI/180),dy=Math.cos(sprite.direction*Math.PI/180);if(sprite.x>220||sprite.x< -220)dx=-dx;if(sprite.y>160||sprite.y< -160)dy=-dy;sprite.x=Math.max(-230,Math.min(230,sprite.x));sprite.y=Math.max(-170,Math.min(170,sprite.y));sprite.direction=Math.atan2(dx,dy)*180/Math.PI;},
    say(text){sprite.bubble=String(text);sprite.bubbleUntil=Infinity;},
    async sayFor(text,seconds){this.say(text);await sleep(Math.max(0,Number(seconds)||0)*1000);sprite.bubble='';},
    wait(seconds){return sleep(Math.max(0,Number(seconds)||0)*1000);},
    getVar(name){if(sprite.variables && Object.prototype.hasOwnProperty.call(sprite.variables,name))return sprite.variables[name];return Object.prototype.hasOwnProperty.call(globalVariables,name)?globalVariables[name]:0;},
    setVar(name,value){if(sprite.variables && Object.prototype.hasOwnProperty.call(sprite.variables,name))sprite.variables[name]=value;else if(Object.prototype.hasOwnProperty.call(globalVariables,name))globalVariables[name]=value;else{if(!sprite.variables)sprite.variables={};sprite.variables[name]=value;}},
    nextCostume(){if(sprite.images.length)sprite.costumeIndex=(sprite.costumeIndex+1)%sprite.images.length;},
    switchCostume(name){const index=sprite.images.findIndex(item=>String(item.costume.name).toLowerCase()===String(name).toLowerCase());if(index>=0)sprite.costumeIndex=index;},
    broadcast(name){broadcast(String(name));},
    async broadcastAndWait(name){await broadcast(String(name));},
    yield(){return new Promise(resolve=>requestAnimationFrame(resolve));}
  });
  const broadcast = async name => {
    const jobs=[];
    for(const target of project.sprites){
      for(const script of target.scripts || []){
        if(script.trigger.type==='broadcast' && script.trigger.name===name) jobs.push(launch(target.isStage?stage:sprites.find(item=>item.name===target.name)||target,script));
      }
    }
    await Promise.all(jobs.filter(Boolean));
  };
  const launch = (sprite, script) => {
    if (!running) return;
    const api=apiFor(sprite);
    try { return (new Function('api','input','return (async()=>{'+script.code+'})()'))(api,input).catch(error=>console.error('Native script error:',error)); }
    catch(error){console.error('Native script error:',error);return Promise.resolve();}
  };
  const runTrigger = type => { (stage.scripts || []).filter(s=>s.trigger.type===type).forEach(s=>launch(stage,s)); sprites.forEach(sprite => sprite.scripts.filter(s=>s.trigger.type===type).forEach(s=>launch(sprite,s))); };
  const spriteReset = () => sprites.forEach(sprite=>{sprite.running=true;});
  const resize = () => {const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);};
  addEventListener('resize',resize);resize();
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();input.mouseX=(e.clientX-r.left-r.width/2)*480/r.width;input.mouseY=-(e.clientY-r.top-r.height/2)*360/r.height;});
  canvas.addEventListener('pointerdown',()=>{input.mouseDown=true;runTrigger('stage-click');sprites.forEach(s=>{const dx=input.mouseX-s.x,dy=input.mouseY-s.y;if(Math.hypot(dx,dy)<28)s.scripts.filter(x=>x.trigger.type==='click').forEach(x=>launch(s,x));});});
  addEventListener('pointerup',()=>input.mouseDown=false);
  addEventListener('keydown',e=>{const key=normalizeKey(e.key);input.keys.add(key);(stage.scripts||[]).filter(x=>x.trigger.type==='key'&&x.trigger.key===key).forEach(x=>launch(stage,x));sprites.forEach(s=>s.scripts.filter(x=>x.trigger.type==='key'&&x.trigger.key===key).forEach(x=>launch(s,x)));});
  addEventListener('keyup',e=>input.keys.delete(normalizeKey(e.key)));
  document.querySelector('#flag').addEventListener('click',()=>{running=true;spriteReset();runTrigger('flag');});
  const draw = () => {
    const w=innerWidth,h=innerHeight;ctx.clearRect(0,0,w,h);ctx.fillStyle='#171923';ctx.fillRect(0,0,w,h);
    ctx.save();ctx.translate(w/2,h/2);ctx.scale(w/480,h/360);
    ctx.fillStyle='#fff';ctx.fillRect(-240,-180,480,360);
    if(stage.images[0]&&stage.images[0].complete&&stage.images[0].naturalWidth)ctx.drawImage(stage.images[0],-240,-180,480,360);
    for(const s of sprites){if(!s.visible)continue;ctx.save();ctx.translate(s.x,-s.y);ctx.rotate((s.direction-90)*Math.PI/180);ctx.scale(s.size/100,s.size/100);
      const costume=s.images[s.costumeIndex]||s.images[0];
      if(costume&&costume.image.complete&&costume.image.naturalWidth){const im=costume.image,c=costume.costume;const cx=Number.isFinite(c.rotationCenterX)?c.rotationCenterX:im.naturalWidth/2,cy=Number.isFinite(c.rotationCenterY)?c.rotationCenterY:im.naturalHeight/2;ctx.drawImage(im,-cx,-cy);}
      else{ctx.fillStyle='#4c97ff';ctx.strokeStyle='#245a9b';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,20,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(6,-5,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(6,5,3,0,Math.PI*2);ctx.fill();}
      ctx.restore();
      if(s.bubble){ctx.fillStyle='#fff';ctx.strokeStyle='#333';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(s.x-45,-s.y-54,90,28,8);ctx.fill();ctx.stroke();ctx.fillStyle='#222';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(s.bubble.slice(0,18),s.x,-s.y-36);}
    }
    ctx.restore();requestAnimationFrame(draw);
  };draw();
  document.querySelector('#project-name').textContent=project.meta.projectName;
  if(project.unsupportedOpcodes.length){const warning=document.querySelector('#warning');warning.hidden=false;warning.textContent='Unsupported Scratch blocks: '+project.unsupportedOpcodes.join(', ');}
})();
`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(title).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}</title>
<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171923;font:14px system-ui,sans-serif}canvas{display:block;width:100%;height:100%;touch-action:none}#toolbar{position:fixed;z-index:2;left:12px;top:12px;display:flex;gap:10px;align-items:center;color:#fff}button{border:0;border-radius:24px;padding:10px 16px;background:#4c97ff;color:white;font-weight:700;cursor:pointer}#warning{position:fixed;bottom:10px;left:10px;right:10px;padding:10px;background:#7a341e;color:#fff;border-radius:8px;max-height:25vh;overflow:auto}</style>
</head><body><div id="toolbar"><button id="flag" aria-label="Start project">⚑ Start</button><span id="project-name"></span></div><canvas></canvas><div id="warning" hidden></div><script>${source.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
};
