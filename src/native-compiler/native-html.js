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
  const hitTest = (target, x, y) => {
    const costume = currentCostume(target);
    const image = imageFor(costume);
    const scale = (target.size || 100) / 100;
    const width = image && image.naturalWidth ? image.naturalWidth * scale : 42 * scale;
    const height = image && image.naturalHeight ? image.naturalHeight * scale : 42 * scale;
    return Math.abs(x - target.x) <= width / 2 && Math.abs(y - target.y) <= height / 2;
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

  const drawTarget = target => {
    if (!target.visible || !target.alive) return;
    const costume = currentCostume(target);
    const image = imageFor(costume);
    context.save();
    context.translate(target.x, -target.y);
    if (target.rotationStyle === 'all around') context.rotate(((target.direction == null ? 90 : target.direction) - 90) * Math.PI / 180);
    else if (target.rotationStyle === 'left-right' && target.direction < 0) context.scale(-1, 1);
    context.scale((target.size || 100) / 100, (target.size || 100) / 100);
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
    if (runtime) runtime.targets.filter(target => !target.isStage).sort((a,b) => a.layerOrder-b.layerOrder).forEach(drawTarget);
    context.restore();
  };

  runtime = new NativeRuntime(project, {
    onTargets(targets) {
      for (const target of targets) {
        for (const costume of costumesFor(target)) imageFor(costume);
      }
    },
    onTargetChange() { draw(); },
    onVariable() { draw(); },
    onClone() { draw(); },
    onDeleteClone() { draw(); },
    onStart() { status.textContent = '実行中'; status.dataset.running = 'true'; },
    onStop() { status.textContent = '停止中'; status.dataset.running = 'false'; draw(); },
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
  resize();
  document.getElementById('project-name').textContent = project.projectName || 'Scratch project';
  draw();
  const unsupported = new Set();
  for (const target of project.targets) {
    for (const block of Object.values(target.blocks || {})) {
      if (block && !block.shadow && !block.disabled && block.topLevel !== undefined) {
        if (!NATIVE_RUNTIME_SUPPORTED.has(block.opcode)) unsupported.add(block.opcode);
      }
    }
  }
  if (unsupported.size) {
    warning.hidden = false;
    warning.textContent = '未対応ブロック: ' + Array.from(unsupported).sort().join(' / ');
  }
  if (project.nativeOptions.autoplay) runtime.start();
  if (project.nativeOptions.custom && project.nativeOptions.custom.js) {
    try { (new Function('runtime', 'project', project.nativeOptions.custom.js))(runtime, project); }
    catch (error) { warning.hidden = false; warning.textContent = 'カスタムJavaScriptエラー: ' + error.message; }
  }
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
main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px}
#stage{width:100%;height:100%;max-width:100%;max-height:100%;aspect-ratio:4/3;object-fit:contain;background:#202536;border-radius:12px;touch-action:none;box-shadow:0 16px 50px #0005}
#warning{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-height:30vh;overflow:auto;padding:12px 14px;border:1px solid #d69a43;border-radius:12px;background:#3d2c19;color:#ffe1b1;line-height:1.5;white-space:pre-wrap}
[hidden]{display:none!important}
${options.custom && options.custom.css ? options.custom.css.split('</style').join('<\\/style') : ''}
@media(max-width:520px){header{height:54px;flex-basis:54px;padding:6px 8px;gap:6px}.brand{display:none}button{padding:8px 11px;min-height:42px}main{padding:4px}#stage{border-radius:8px}}
</style>
</head>
<body>
<header><span class="brand">Native Scratch</span><span id="project-name"></span><span id="status">停止中</span><button id="start">⚑ 実行</button><button id="stop" class="secondary">停止</button></header>
<main><canvas id="stage" aria-label="Scratch project stage"></canvas></main>
<div id="warning" hidden role="status"></div>
<script>${source.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
};
