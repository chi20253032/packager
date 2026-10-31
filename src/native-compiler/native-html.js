import {getNativeRuntimeSource} from './runtime';

const safe = value => JSON.stringify(value).replace(/</g, '\\u003c');
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);

/**
 * Create a standalone player driven by the independent native SB3 interpreter.
 * No Scratch VM, Scratch Player, renderer, audio engine, or scaffold is loaded.
 */
export const createNativeHTML = (project, title = 'Scratch project', options = {}) => {
  if (!project || !Array.isArray(project.targets)) {
    throw new Error('Invalid SB3 project: targets are missing.');
  }
  const nativeOptions = {
    turbo: !!options.turbo, framerate: options.framerate == null ? 30 : options.framerate,
    maxClones: options.maxClones === Infinity ? null : (options.maxClones == null ? 300 : options.maxClones),
    fencing: options.fencing !== false, miscLimits: options.miscLimits !== false,
    stageWidth: options.stageWidth == null ? 480 : options.stageWidth, stageHeight: options.stageHeight == null ? 360 : options.stageHeight,
    resizeMode: options.resizeMode || 'preserve-ratio', username: options.username || 'player####',
    autoplay: !!options.autoplay, appearance: options.appearance || {},
    controls: options.controls || {}, monitors: options.monitors || {}, loadingScreen: options.loadingScreen || {},
    cursor: options.cursor || {}, chunks: options.chunks || {}, cloudVariables: options.cloudVariables || {},
    projectId: options.projectId || project.projectId || '',
    custom: options.custom || {}
  };
  const projectJSON = safe({...project, nativeOptions});
  const runtimeSource = getNativeRuntimeSource();
  const source = `
(() => {
  'use strict';
  const project = ${projectJSON};
  ${runtimeSource}

  const canvas = document.getElementById('stage');
  const context = canvas.getContext('2d', {alpha:false});
  const warning = document.getElementById('warning');
  const status = document.getElementById('status');
  const monitorPanel = document.getElementById('monitors');
  const images = new Map();
  const imageFor = costume => {
    if (!costume) return null;
    const asset = costume.md5ext || (costume.assetId && (costume.assetId + '.' + costume.dataFormat));
    const encoded = asset && project.nativeAssets && project.nativeAssets[asset];
    if (!encoded) return null;
    if (images.has(asset)) return images.get(asset);
    const format = String(costume.dataFormat || asset.split('.').pop() || 'png').toLowerCase();
    const mime = format === 'svg' ? 'image/svg+xml' : (format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png');
    const image = new Image();
    image.src = 'data:' + mime + ';base64,' + encoded;
    images.set(asset, image);
    return image;
  };

  let runtime;
  let dpr = 1;
  const stageWidth = Number(project.nativeOptions.stageWidth) || 480;
  const stageHeight = Number(project.nativeOptions.stageHeight) || 360;
  const penCanvas = document.createElement('canvas');
  penCanvas.width = Math.ceil(stageWidth);
  penCanvas.height = Math.ceil(stageHeight);
  const penContext = penCanvas.getContext('2d');
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    draw();
  };
  const screenPoint = event => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * stageWidth / rect.width - stageWidth / 2,
      y: stageHeight / 2 - (event.clientY - rect.top) * stageHeight / rect.height
    };
  };
  const costumesFor = target => target.costumes || [];
  const currentCostume = target => costumesFor(target)[Math.max(0, Math.min(costumesFor(target).length - 1, target.currentCostume || 0))];
  const alphaMasks = new WeakMap();
  const hitTest = (target, x, y) => {
    if (!target || !target.visible || !target.alive) return false;
    const costume=currentCostume(target), image=imageFor(costume), scale=Math.max(0.001,Math.abs(target.size||100)/100);
    const angle=target.rotationStyle==='all around'?((target.direction||90)-90)*Math.PI/180:0;
    const dx=x-target.x, dy=-(y-target.y);
    const localX=(dx*Math.cos(angle)+dy*Math.sin(angle))/scale;
    const localY=(-dx*Math.sin(angle)+dy*Math.cos(angle))/scale;
    const cx=Number.isFinite(costume?.rotationCenterX)?costume.rotationCenterX:(image?.naturalWidth||48)/2;
    const cy=Number.isFinite(costume?.rotationCenterY)?costume.rotationCenterY:(image?.naturalHeight||48)/2;
    const px=Math.floor(localX+cx), py=Math.floor(localY+cy);
    if(!image || !image.complete || !image.naturalWidth) return Math.abs(localX)<=24 && Math.abs(localY)<=24;
    if(px<0 || py<0 || px>=image.naturalWidth || py>=image.naturalHeight) return false;
    try {
      let mask=alphaMasks.get(image);
      if(!mask) {
        const bitmap=document.createElement('canvas'); bitmap.width=image.naturalWidth; bitmap.height=image.naturalHeight;
        const bitmapContext=bitmap.getContext('2d',{willReadFrequently:true}); bitmapContext.drawImage(image,0,0);
        mask={width:bitmap.width,height:bitmap.height,data:bitmapContext.getImageData(0,0,bitmap.width,bitmap.height).data};
        alphaMasks.set(image,mask);
      }
      return mask.data[(py*mask.width+px)*4+3]>8;
    } catch (_) {
      return true;
    }
  };
  let audioContext = null;
  const audioBuffers = new Map();
  const playingSources = new Set();
  const getAudioContext = () => {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    return audioContext;
  };
  const playSound = async (target, soundName) => {
    try {
      const sound = (target.sounds || []).find(item => item.name === soundName) || (target.sounds || [])[0];
      if (!sound) return;
      const asset = sound.md5ext || (sound.assetId && (sound.assetId + '.' + (sound.dataFormat || sound.format)));
      const encoded = asset && project.nativeAssets && project.nativeAssets[asset];
      if (!encoded) return;
      const audio = getAudioContext();
      if (!audio) return;
      if (!audioBuffers.has(asset)) {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
        audioBuffers.set(asset, audio.decodeAudioData(bytes.buffer));
      }
      const buffer = await audioBuffers.get(asset);
      await audio.resume();
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      gain.gain.value = Math.max(0, Math.min(1, (target.volume == null ? 100 : target.volume) / 100));
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(audio.destination);
      playingSources.add(source);
      source.onended = () => playingSources.delete(source);
      source.start(0);
      return new Promise(resolve => { source.onended = () => { playingSources.delete(source); resolve(); }; });
    } catch (error) {
      console.warn('Native audio playback failed:', error);
    }
  };
  const stopAllSounds = () => {
    for (const source of playingSources) {
      try { source.stop(); } catch (error) { /* already stopped */ }
    }
    playingSources.clear();
  };

  const playMusicNote = async (note,beats,instrument,tempo) => {
    const audio=getAudioContext();
    if(!audio) return;
    await audio.resume();
    const duration=Math.max(0.025,beats*60/Math.max(1,tempo));
    const oscillator=audio.createOscillator(), gain=audio.createGain();
    const waveforms=['sine','triangle','sine','sine','sawtooth','square','triangle','sine','triangle','sawtooth','square','triangle','sine','sawtooth','triangle','square','sine','triangle','sawtooth','square','sine'];
    oscillator.type=waveforms[Math.max(0,Math.min(waveforms.length-1,(instrument||1)-1))];
    oscillator.frequency.setValueAtTime(440*Math.pow(2,(note-69)/12),audio.currentTime);
    gain.gain.setValueAtTime(0.0001,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16,audio.currentTime+0.015);
    gain.gain.setTargetAtTime(0.0001,audio.currentTime+Math.max(0.02,duration-0.04),0.025);
    oscillator.connect(gain); gain.connect(audio.destination);
    playingSources.add(oscillator);
    oscillator.onended=()=>playingSources.delete(oscillator);
    oscillator.start(); oscillator.stop(audio.currentTime+duration+0.08);
    return new Promise(resolve=>{oscillator.addEventListener('ended',resolve,{once:true});});
  };
  const playMusicDrum = async (drum,beats,tempo) => {
    const audio=getAudioContext();
    if(!audio) return;
    await audio.resume();
    const duration=Math.max(0.04,beats*60/Math.max(1,tempo));
    const oscillator=audio.createOscillator(), gain=audio.createGain();
    const frequencies={1:58,2:150,3:95,4:220,5:330,6:520,7:760,8:1100,9:1600,10:90,11:180,12:260,13:420,14:620,15:880,16:1200,17:75,18:140,19:240,20:480,21:960};
    oscillator.type=drum===1?'sine':(drum===2?'triangle':'square');
    oscillator.frequency.setValueAtTime(frequencies[drum]||180,audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35,(frequencies[drum]||180)*0.35),audio.currentTime+duration);
    gain.gain.setValueAtTime(0.0001,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(drum===1?0.8:0.35,audio.currentTime+0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001,audio.currentTime+duration);
    oscillator.connect(gain); gain.connect(audio.destination);
    playingSources.add(oscillator);
    oscillator.onended=()=>playingSources.delete(oscillator);
    oscillator.start(); oscillator.stop(audio.currentTime+duration+0.02);
    return new Promise(resolve=>{oscillator.addEventListener('ended',resolve,{once:true});});
  };

  const drawTarget = target => {
    if (!target.visible || !target.alive) return;
    const costume = currentCostume(target);
    const image = imageFor(costume);
    context.save();
    context.translate(target.x, -target.y);
    if (target.rotationStyle === 'all around') context.rotate(((target.direction == null ? 90 : target.direction) - 90) * Math.PI / 180);
    else if (target.rotationStyle === 'left-right' && target.direction < 0) context.scale(-1, 1);
    context.scale((target.size || 100) / 100, (target.size || 100) / 100);
    const effects=target.effects||{};
    const brightness=Math.max(-100,Math.min(100,Number(effects.brightness)||0));
    const color=Math.max(0,Math.min(200,Number(effects.color)||0));
    context.filter='brightness('+(1+brightness/100)+') hue-rotate('+(color*1.8)+'deg)';
    context.globalAlpha=Math.max(0,1-(Number(effects.ghost)||0)/100);
    if (image && image.complete && image.naturalWidth) {
      const cx = Number.isFinite(costume.rotationCenterX) ? costume.rotationCenterX : image.naturalWidth / 2;
      const cy = Number.isFinite(costume.rotationCenterY) ? costume.rotationCenterY : image.naturalHeight / 2;
      context.drawImage(image, -cx, -cy);
    } else {
      context.fillStyle = '#4c97ff';
      context.beginPath(); context.arc(0, 0, 20, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#fff';
      context.beginPath(); context.arc(6, -5, 3, 0, Math.PI * 2); context.fill();
      context.beginPath(); context.arc(6, 5, 3, 0, Math.PI * 2); context.fill();
    }
    context.restore();
    if (target.bubble && target.bubble.text) {
      const bubbleText = String(target.bubble.text);
      context.save();
      context.font = '14px system-ui, sans-serif';
      const width = Math.min(220, Math.max(72, context.measureText(bubbleText).width + 22));
      const bx = Math.max(-stageWidth / 2, Math.min(stageWidth / 2 - width, target.x + 18));
      const by = Math.max(-stageHeight / 2 + 32, Math.min(stageHeight / 2 - 8, -target.y - 52));
      context.fillStyle = '#fff'; context.strokeStyle = '#333'; context.lineWidth = 1.5;
      context.beginPath(); context.roundRect(bx, by, width, 34, 9); context.fill(); context.stroke();
      context.fillStyle = '#222'; context.textAlign = 'left'; context.textBaseline = 'middle';
      context.fillText(bubbleText, bx + 10, by + 17, width - 20);
      context.restore();
    }
  };

  const renderMonitors = () => {
    if(!monitorPanel || !runtime) return;
    monitorPanel.replaceChildren();
    const settings=project.nativeOptions.monitors||{};
    if(settings.visible===false) { monitorPanel.hidden=true; return; }
    monitorPanel.hidden=false;
    for(const target of runtime.targets) {
      for(const variable of Object.values(target.variables||{})) {
        const item=document.createElement('div'); item.className='monitor';
        const label=document.createElement('span'); label.textContent=(target.isStage?'Stage':target.name)+' · '+variable.name;
        const value=document.createElement('strong'); value.textContent=String(variable.value);
        value.style.color=settings.variableColor||'#ff8c1a';
        item.append(label,value); monitorPanel.append(item);
      }
      for(const list of Object.values(target.lists||{})) {
        const item=document.createElement('div'); item.className='monitor list-monitor';
        const label=document.createElement('span'); label.textContent=(target.isStage?'Stage':target.name)+' · '+list.name;
        item.append(label);
        if(settings.editableLists) {
          const editor=document.createElement('textarea'); editor.rows=2; editor.value=list.value.join('\\n');
          editor.setAttribute('aria-label','Edit list '+list.name);
          editor.addEventListener('change',()=>{list.value=editor.value.split(/\\r?\\n/);});
          item.append(editor);
        } else {
          const value=document.createElement('strong'); value.textContent=list.value.join(', ');
          value.style.color=settings.listColor||'#fc662c'; item.append(value);
        }
        monitorPanel.append(item);
      }
    }
    if(!monitorPanel.childElementCount) { const empty=document.createElement('span'); empty.textContent='表示できる変数・リストはありません'; monitorPanel.append(empty); }
  };

  const draw = () => {
    if (!context) return;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#202536';
    context.fillRect(0, 0, width, height);
    const scaleX = width / stageWidth, scaleY = height / stageHeight;
    const scale = project.nativeOptions.resizeMode === 'stretch' ? null : Math.min(scaleX, scaleY);
    const drawScaleX = scale === null ? scaleX : scale;
    const drawScaleY = scale === null ? scaleY : scale;
    const left = (width - stageWidth * drawScaleX) / 2;
    const top = (height - stageHeight * drawScaleY) / 2;
    context.save();
    context.translate(left, top);
    context.scale(drawScaleX, drawScaleY);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, stageWidth, stageHeight);
    const stage = runtime && runtime.stage;
    const backdrop = stage && currentCostume(stage);
    const backdropImage = imageFor(backdrop);
    if (backdropImage && backdropImage.complete && backdropImage.naturalWidth) {
      context.drawImage(backdropImage, 0, 0, stageWidth, stageHeight);
    }
    if (penCanvas.width) context.drawImage(penCanvas, 0, 0, stageWidth, stageHeight);
    if (runtime) {
      context.save();
      context.translate(stageWidth/2,stageHeight/2);
      runtime.targets.filter(target => !target.isStage).sort((a,b) => a.layerOrder-b.layerOrder).forEach(drawTarget);
      context.restore();
    }
    context.restore();
  };

  const cloudSettings=project.nativeOptions.cloudVariables||{};
  let cloudSocket=null;
  const cloudEnabledFor=variable=>{
    if(!variable.cloud) return false;
    if(cloudSettings.mode==='ws') return true;
    if(cloudSettings.mode==='custom') return cloudSettings.custom?.[variable.name]==='ws';
    return false;
  };
  const sendCloud=(name,value)=>{
    if(!cloudSocket || cloudSocket.readyState!==WebSocket.OPEN) return;
    const text=String(value);
    if(!cloudSettings.unsafeCloudBehaviors && (!Number.isFinite(Number(text)) || text.length>256)) return;
    cloudSocket.send(JSON.stringify({method:'set',name,value:text}));
  };
  const cloudVariables=project.targets.flatMap(target=>Object.values(target.variables||{}).map(item=>({name:item[0],value:item[1],cloud:!!item[2]}))).filter(cloudEnabledFor);
  if(cloudVariables.length && cloudSettings.mode!=='local' && cloudSettings.mode!=='') {
    const cloudHost=cloudSettings.cloudHost||'wss://clouddata.turbowarp.org';
    const projectId=String(project.nativeOptions.projectId||'').trim();
    if(!projectId) {
      warning.hidden=false;
      warning.textContent='クラウド変数を使用するには、Packager設定でプロジェクトIDを指定してください。';
    } else if(typeof WebSocket!=='undefined') {
      try {
        cloudSocket=new WebSocket(cloudHost);
        cloudSocket.addEventListener('open',()=>{
          cloudSocket.send(JSON.stringify({method:'handshake',user:runtime.username,project_id:projectId}));
          for(const variable of cloudVariables) sendCloud(variable.name,variable.value);
        });
        cloudSocket.addEventListener('message',event=>{
          try {
            const message=JSON.parse(event.data);
            if(message.method==='set' && typeof message.name==='string') runtime.applyCloudVariable(message.name,message.value);
          } catch(error) { console.warn('Invalid native cloud message',error); }
        });
        cloudSocket.addEventListener('error',()=>{
          warning.hidden=false;
          warning.textContent='クラウド変数サーバーに接続できませんでした。ローカル実行は続行できます。';
        });
      } catch(error) {
        warning.hidden=false;
        warning.textContent='クラウド変数接続エラー: '+error.message;
      }
    }
  }

  runtime = new NativeRuntime(project, {
    onTargets(targets) {
      for (const target of targets) {
        for (const costume of costumesFor(target)) imageFor(costume);
      }
    },
    onTargetChange() { draw(); },
    penClear() { penContext.clearRect(0, 0, penCanvas.width, penCanvas.height); draw(); },
    penLine(target, x1, y1, x2, y2) {
      penContext.strokeStyle = target.penColor || '#000000';
      penContext.lineWidth = Math.max(1, target.penSize || 1);
      penContext.lineCap = 'round';
      penContext.lineJoin = 'round';
      penContext.beginPath();
      penContext.moveTo(x1 + stageWidth / 2, stageHeight / 2 - y1);
      penContext.lineTo(x2 + stageWidth / 2, stageHeight / 2 - y2);
      penContext.stroke();
      draw();
    },
    penStamp(target) {
      const costume = currentCostume(target), image = imageFor(costume);
      if (!image || !image.complete || !image.naturalWidth) return;
      penContext.save();
      penContext.translate(target.x + stageWidth / 2, stageHeight / 2 - target.y);
      if (target.rotationStyle === 'all around') penContext.rotate(((target.direction || 90) - 90) * Math.PI / 180);
      penContext.scale((target.size || 100) / 100, (target.size || 100) / 100);
      const cx = Number.isFinite(costume.rotationCenterX) ? costume.rotationCenterX : image.naturalWidth / 2;
      const cy = Number.isFinite(costume.rotationCenterY) ? costume.rotationCenterY : image.naturalHeight / 2;
      penContext.drawImage(image, -cx, -cy);
      penContext.restore();
      draw();
    },
    onVariable() { draw(); renderMonitors(); },
    onList() { renderMonitors(); },
    onCloudVariable(name,value) { if(cloudEnabledFor({cloud:true,name})) sendCloud(name,value); },
    onClone() { draw(); renderMonitors(); },
    onDeleteClone() { draw(); renderMonitors(); },
    onStart() { status.textContent = '実行中'; status.dataset.running = 'true'; renderMonitors(); },
    onStop() { status.textContent = '停止中'; status.dataset.running = 'false'; draw(); renderMonitors(); },
    onPause() { status.textContent='一時停止'; },
    onResume() { status.textContent='実行中'; },
    onError(error, target, block) {
      warning.hidden = false;
      warning.textContent = '実行エラー (' + (target && target.name || 'Sprite') + ' / ' + (block && block.opcode || 'script') + '): ' + error.message;
    },
    onUnsupported(opcode) {
      const current = warning.textContent ? warning.textContent.split(' / ') : [];
      if (!current.includes(opcode)) current.push(opcode);
      warning.hidden = false;
      warning.textContent = '未対応ブロック: ' + current.join(' / ');
    },
    hitTest,
    playSound,
    playMusicNote,
    playMusicDrum,
    stopAllSounds,
    ask(question) { return Promise.resolve(window.prompt(question) || ''); }
  });

  const start = document.getElementById('start');
  const stop = document.getElementById('stop');
  start.addEventListener('click', () => {
    warning.hidden = true;
    warning.textContent = '';
    const audio = getAudioContext();
    if (audio) audio.resume();
    runtime.start();
  });
  stop.addEventListener('click', () => runtime.stopAll());
  window.addEventListener('beforeunload',()=>{ if(cloudSocket) cloudSocket.close(); });
  const pauseButton=document.getElementById('pause');
  if(pauseButton) pauseButton.addEventListener('click',()=>{
    if(runtime.paused) { runtime.resume(); pauseButton.textContent='一時停止'; }
    else { runtime.pause(); pauseButton.textContent='再開'; }
  });
  const fullscreenButton=document.getElementById('fullscreen');
  if(fullscreenButton) fullscreenButton.addEventListener('click',()=>{
    if(document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  });

  canvas.addEventListener('pointermove', event => {
    const point = screenPoint(event);
    runtime.pointerMove(point.x, point.y);
  });
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
    const point = screenPoint(event);
    runtime.pointerDown(point.x, point.y);
  });
  canvas.addEventListener('pointerup', () => runtime.pointerUp());
  canvas.addEventListener('pointercancel', () => runtime.pointerUp());
  window.addEventListener('keydown', event => {
    if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    runtime.keyDown(event.key);
  });
  window.addEventListener('keyup', event => runtime.keyUp(event.key));
  window.addEventListener('blur', () => {
    runtime.keys.clear();
    runtime.pointerUp();
  });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  canvas.style.aspectRatio = stageWidth + ' / ' + stageHeight;
  canvas.style.maxWidth = 'calc((100dvh - 82px) * ' + (stageWidth / stageHeight) + ')';
  if (project.nativeOptions.appearance && project.nativeOptions.appearance.background) document.body.style.background = project.nativeOptions.appearance.background;
  if (project.nativeOptions.appearance && project.nativeOptions.appearance.foreground) document.body.style.color = project.nativeOptions.appearance.foreground;
  resize();
  renderMonitors();
  document.getElementById('project-name').textContent = project.projectName || 'Scratch project';
  draw();
  if (project.nativeOptions.custom && project.nativeOptions.custom.js) {
    try { (new Function('runtime', 'project', project.nativeOptions.custom.js))(runtime, project); }
    catch (error) { warning.hidden = false; warning.textContent = 'カスタムJavaScriptエラー: ' + error.message; }
  }
  const unsupported = new Set();
  for (const target of project.targets) {
    for (const block of Object.values(target.blocks || {})) {
      if (block && !block.shadow && !block.disabled && block.topLevel !== undefined) {
        if (!NATIVE_RUNTIME_SUPPORTED.has(block.opcode) && !runtime.extensions[block.opcode]) unsupported.add(block.opcode);
      }
    }
  }
  if (unsupported.size) {
    warning.hidden = false;
    warning.textContent = '未対応ブロック: ' + Array.from(unsupported).sort().join(' / ');
  }
  if (project.nativeOptions.autoplay) runtime.start();
})();
`;

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#171b29">
<title>${escapeHTML(title)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171b29;color:#f4f6ff;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:flex;flex-direction:column;min-height:100dvh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
header{height:58px;flex:0 0 58px;display:flex;align-items:center;gap:10px;padding:8px 14px;background:#22283a;border-bottom:1px solid #394157}
.brand{font-weight:800;letter-spacing:-.02em;white-space:nowrap}
#project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c5cee2;flex:1}
#status{font-size:12px;color:#aebbd3}
button{border:0;border-radius:12px;min-height:42px;padding:9px 15px;background:#4c97ff;color:white;font:inherit;font-weight:750;touch-action:manipulation}
button.secondary{background:#39445e}
main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px;position:relative}
#stage{width:100%;height:100%;max-width:100%;max-height:100%;aspect-ratio:4/3;object-fit:contain;background:#202536;border-radius:12px;touch-action:none;box-shadow:0 16px 50px #0005}
#monitors{position:fixed;z-index:5;left:10px;top:68px;max-width:min(280px,48vw);max-height:38vh;overflow:auto;display:flex;flex-direction:column;gap:5px;padding:7px;border-radius:10px;background:#151a28d9;border:1px solid #64708a88;color:#f4f6ff;font-size:12px;backdrop-filter:blur(10px)}
.monitor{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:4px 6px;border-radius:6px;background:#30394e}.monitor strong{overflow-wrap:anywhere}.list-monitor{display:block}.monitor textarea{width:100%;margin-top:4px;min-height:42px;border-radius:6px;background:#111827;color:inherit;border:1px solid #64708a;padding:5px;font:inherit}
#warning{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-height:30vh;overflow:auto;padding:12px 14px;border:1px solid #d69a43;border-radius:12px;background:#3d2c19;color:#ffe1b1;line-height:1.5;white-space:pre-wrap}
[hidden]{display:none!important}
${options.custom && options.custom.css ? options.custom.css.split('</style').join('<\\/style') : ''}
@media(max-width:520px){header{height:54px;flex-basis:54px;padding:6px 8px;gap:6px}.brand{display:none}button{padding:8px 11px;min-height:42px}main{padding:4px}#stage{border-radius:8px}}
</style>
</head>
<body>
<header><span class="brand">Native Scratch</span><span id="project-name"></span><span id="status">停止中</span><button id="start">⚑ 実行</button><button id="stop" class="secondary">停止</button>${options.controls && options.controls.pause && options.controls.pause.enabled ? '<button id="pause" class="secondary">一時停止</button>' : ''}${options.controls && options.controls.fullscreen && options.controls.fullscreen.enabled ? '<button id="fullscreen" class="secondary">全画面</button>' : ''}</header>
<main><canvas id="stage" aria-label="Scratch project stage"></canvas></main>
<aside id="monitors" aria-label="変数とリスト"></aside>
<div id="warning" hidden role="status"></div>
<script>${source.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
};
