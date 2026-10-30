/**
 * Native Scratch-compatible block runtime.
 *
 * This module interprets SB3 block graphs directly. It does not import or call
 * scratch-vm. Rendering, audio and platform-specific extension hosts are
 * injected through the host interface.
 *
 * MPL-2.0
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const text = value => value === null || value === undefined ? '' : String(value);
const truthy = value => {
  if (typeof value === 'string') return value.length > 0 && value !== '0';
  return Boolean(value);
};
const NATIVE_RUNTIME_SUPPORTED = new Set(["event_whenflagclicked","event_whenkeypressed","event_whenthisspriteclicked","event_whenstageclicked","event_whenbroadcastreceived","event_whenbackdropswitchesto","control_start_as_clone","motion_movesteps","motion_turnright","motion_turnleft","motion_goto","motion_gotoxy","motion_glidesecstoxy","motion_setx","motion_sety","motion_changexby","motion_changeyby","motion_pointindirection","motion_pointtowards","motion_ifonedgebounce","motion_xposition","motion_yposition","motion_direction","looks_show","looks_hide","looks_setsizeto","looks_changesizeby","looks_nextcostume","looks_switchcostumeto","looks_say","looks_think","looks_sayforsecs","looks_thinkforsecs","looks_gotofrontback","looks_goforwardbackwardlayers","looks_switchbackdropto","looks_switchbackdroptoandwait","looks_nextbackdrop","looks_size","looks_costumenumbername","data_variable","data_setvariableto","data_changevariableby","data_listcontents","data_lengthoflist","data_addtolist","data_deleteoflist","data_deletealloflist","data_insertatlist","data_replaceitemoflist","data_itemoflist","data_itemnumoflist","data_listcontainsitem","control_wait","control_repeat","control_forever","control_if","control_if_else","control_repeat_until","control_wait_until","control_stop","control_create_clone_of","control_delete_this_clone","event_broadcast","event_broadcastandwait","math_number","math_integer","math_whole_number","text","logic_boolean","logic_null","colour_picker","math_add","math_subtract","math_multiply","math_divide","math_modulo","math_round","math_random","math_single","operator_add","operator_subtract","operator_multiply","operator_divide","operator_mod","operator_round","operator_random","operator_mathop","operator_equals","operator_gt","operator_lt","operator_and","operator_or","operator_not","operator_join","operator_length","operator_contains","operator_letter_of","operator_of","sensing_mousex","sensing_mousey","sensing_mousedown","sensing_keypressed","sensing_timer","sensing_resettimer","sensing_answer","sensing_askandwait","sensing_username","sensing_current","sensing_dayssince2000","sensing_distanceto","sensing_touchingobject","sound_sounds_menu","sound_volume","sound_play","sound_playuntildone","sound_setvolumeto","sound_setvolume","sound_changevolumeby","sound_changevolume","sound_stopallsounds","motion_goto_menu","motion_pointtowards_menu","looks_costume","looks_backdrops","event_broadcast_menu","control_create_clone_of_menu","sensing_keyoptions","sensing_touchingobjectmenu","sensing_distancetomenu","sensing_of_object_menu","sensing_of","looks_backdropnumbername","motion_setrotationstyle","pen_clear","pen_eraseAll","pen_penDown","pen_penUp","pen_setPenColorToColor","pen_setPenSizeTo","pen_changePenSizeBy","pen_stamp"]);

const keyName = value => ({
  ' ':'space', 'arrowup':'up', 'arrowdown':'down', 'arrowleft':'left',
  'arrowright':'right', 'enter':'enter', 'escape':'escape'
})[text(value).toLowerCase()] || text(value).toLowerCase();

export class NativeRuntime {
  static clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  static number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  static text(value) { return value === null || value === undefined ? '' : String(value); }
  static truthy(value) {
    if (typeof value === 'string') return value.length > 0 && value !== '0';
    return Boolean(value);
  }
  static keyName(value) {
    const key = this.text(value).toLowerCase();
    return ({' ':'space','arrowup':'up','arrowdown':'down','arrowleft':'left','arrowright':'right','enter':'enter','escape':'escape'})[key] || key;
  }

  constructor(project, host = {}) {
    if (!project || !Array.isArray(project.targets)) throw new Error('Invalid SB3 project: targets missing');
    this.project = project;
    this.host = host;
    this.extensions = host.extensions || Object.create(null);
    this.options = project.nativeOptions || {};
    this.stageWidth = this.constructor.clamp(this.constructor.number(this.options.stageWidth ?? 480), 1, 10000);
    this.stageHeight = this.constructor.clamp(this.constructor.number(this.options.stageHeight ?? 360), 1, 10000);
    this.maxClones = this.options.maxClones == null ? Infinity : Math.max(0, Math.floor(this.constructor.number(this.options.maxClones)));
    this.fencing = this.options.fencing !== false;
    this.turbo = !!this.options.turbo;
    this.framerate = this.constructor.clamp(this.constructor.number(this.options.framerate ?? 30), 1, 240);
    this.username = this.constructor.text(this.options.username || 'player').replace(/####/g, String(Math.floor(Math.random()*9000)+1000));
    this.running = false;
    this.paused = false;
    this.frame = 0;
    this.startedAt = 0;
    this.keys = new Set();
    this.mouse = {x: 0, y: 0, down: false};
    this.broadcastWaiters = new Map();
    this.threads = new Set();
    this.clones = [];
    this.targets = project.targets.map((raw, index) => this.makeTarget(raw, index));
    this.originalTargets = this.targets.slice();
    this.initialState = new Map(this.originalTargets.map(target => [target, {
      x:target.x, y:target.y, direction:target.direction, size:target.size, visible:target.visible,
      currentCostume:target.currentCostume, volume:target.volume, layerOrder:target.layerOrder,
      penDown:target.penDown, penColor:target.penColor, penSize:target.penSize,
      variables:Object.fromEntries(Object.entries(target.variables).map(([id, item]) => [id, item.value])),
      lists:Object.fromEntries(Object.entries(target.lists).map(([id, item]) => [id, item.value.slice()]))
    }]));
    this.stage = this.targets.find(target => target.isStage) || this.targets[0];
    this.sprites = this.targets.filter(target => !target.isStage);
    this.originalSprites = this.sprites.slice();
    this.globalVariables = this.stage ? this.stage.variables : Object.create(null);
    this.globalLists = this.stage ? this.stage.lists : Object.create(null);
    this.host.onTargets?.(this.targets);
  }

  makeTarget(raw, index) {
    const variables = Object.create(null);
    for (const [id, value] of Object.entries(raw.variables || {})) variables[id] = {id, name: value[0], value: value[1], cloud: !!value[2]};
    const lists = Object.create(null);
    for (const [id, value] of Object.entries(raw.lists || {})) lists[id] = {id, name: value[0], value: Array.isArray(value[1]) ? value[1].slice() : []};
    return {
      id: raw.id || 'target-' + index, name: raw.name || 'Sprite ' + index,
      isStage: !!raw.isStage, blocks: raw.blocks || {}, variables, lists,
      x: this.constructor.number(raw.x), y: this.constructor.number(raw.y), direction: this.constructor.number(raw.direction == null ? 90 : raw.direction),
      size: this.constructor.number(raw.size == null ? 100 : raw.size), visible: raw.visible !== false,
      draggable: !!raw.draggable, rotationStyle: raw.rotationStyle || 'all around',
      currentCostume: this.constructor.number(raw.currentCostume), costumes: raw.costumes || [], sounds: raw.sounds || [], penDown:false, penColor:'#000000', penSize:1,
      volume: this.constructor.number(raw.volume ?? 100), layerOrder: this.constructor.number(raw.layerOrder ?? index),
      effects: {...(raw.effects || {})}, clones: [], alive: true, bubble: null,
      timer: 0, touching: Object.create(null), isOriginal: true
    };
  }

  start() {
    this.stopAll();
    this.targets = this.originalTargets.slice();
    this.clones = [];
    this.stage = this.targets.find(target => target.isStage) || this.targets[0];
    this.sprites = this.targets.filter(target => !target.isStage);
    this.globalVariables = this.stage ? this.stage.variables : Object.create(null);
    this.globalLists = this.stage ? this.stage.lists : Object.create(null);
    for (const target of this.originalTargets) {
      const initial = this.initialState.get(target);
      Object.assign(target, {x:initial.x,y:initial.y,direction:initial.direction,size:initial.size,visible:initial.visible,currentCostume:initial.currentCostume,volume:initial.volume,layerOrder:initial.layerOrder,penDown:initial.penDown,penColor:initial.penColor,penSize:initial.penSize,alive:true,bubble:null,effects:{}});
      for (const [id, value] of Object.entries(initial.variables)) target.variables[id].value = value;
      for (const [id, value] of Object.entries(initial.lists)) target.lists[id].value = value.slice();
    }
    this.running = true;
    this.startedAt = performance.now();
    this.runHat('event_whenflagclicked');
    this.host.onStart?.();
  }

  stopAll() {
    this.running = false;
    for (const thread of this.threads) thread.cancelled = true;
    this.threads.clear();
    this.targets.forEach(target => { target.alive = true; });
    this.host.onStop?.();
  }

  stopTarget(target) {
    for (const thread of this.threads) if (thread.target === target) thread.cancelled = true;
  }

  async yield() {
    if (this.host.yield) return this.host.yield();
    return new Promise(resolve => setTimeout(resolve, this.turbo ? 0 : 1000 / this.framerate));
  }

  fence(target) {
    if (!this.fencing || target.isStage) return;
    target.x = this.constructor.clamp(target.x, -this.stageWidth / 2, this.stageWidth / 2);
    target.y = this.constructor.clamp(target.y, -this.stageHeight / 2, this.stageHeight / 2);
  }

  async wait(seconds, thread) {
    const end = performance.now() + Math.max(0, this.constructor.number(seconds) * 1000);
    while (this.running && !thread.cancelled && performance.now() < end) {
      const remaining = end - performance.now();
      await new Promise(resolve => setTimeout(resolve, Math.min(16, Math.max(1, remaining))));
    }
  }

  getVariable(target, id) {
    return target.variables[id] || this.globalVariables[id] || {value: 0};
  }

  setVariable(target, id, value) {
    const variable = target.variables[id] || this.globalVariables[id];
    if (variable) variable.value = value;
    else target.variables[id] = {id, name: id, value};
    this.host.onVariable?.(target, id, value);
  }

  getList(target, id) {
    return target.lists[id] || this.globalLists[id] || {value: []};
  }

  async runHat(opcode, match = null) {
    if (!this.running) return;
    const jobs = [];
    for (const target of this.targets) {
      if (!target.alive) continue;
      for (const block of Object.values(target.blocks)) {
        if (!block || !block.topLevel || block.shadow || block.opcode !== opcode) continue;
        if (match && !match(block, target)) continue;
        jobs.push(this.launch(target, block));
      }
    }
    return Promise.all(jobs);
  }

  launch(target, hat) {
    if (!this.running || !target.alive) return Promise.resolve();
    const thread = {target, cancelled: false, id: this.threads.size + 1};
    this.threads.add(thread);
    const promise = this.executeStack(target, hat.next, thread)
      .catch(error => this.host.onError?.(error, target, hat))
      .finally(() => this.threads.delete(thread));
    thread.promise = promise;
    return promise;
  }

  inputBlock(target, block, name) {
    const input = block.inputs?.[name];
    if (!input) return null;
    const candidate = input[1] || input[2];
    return typeof candidate === 'string' ? target.blocks[candidate] || null : null;
  }

  shadowValue(block) {
    if (!block) return 0;
    const fields = block.fields || {};
    const first = Object.values(fields)[0];
    if (first) return first[0];
    return block.value ?? 0;
  }

  async value(target, block, name, thread, depth = 0) {
    if (depth > 80) return 0;
    const child = this.inputBlock(target, block, name);
    if (child) return this.evaluate(target, child, thread, depth + 1);
    const input = block.inputs?.[name];
    const shadow = input && (input[1] || input[2]);
    if (Array.isArray(shadow)) {
      if ([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(shadow[0])) return shadow[1];
      return shadow[1] ?? 0;
    }
    return 0;
  }

  registerExtension(opcode, handlers) {
    if (!opcode || !handlers || (typeof handlers.command !== 'function' && typeof handlers.reporter !== 'function')) {
      throw new Error('A native extension must provide a command or reporter handler.');
    }
    this.extensions[opcode] = handlers;
  }

  field(block, name, fallback = '') {
    return block.fields?.[name]?.[0] ?? fallback;
  }

  fieldId(block, name, fallback = '') {
    const field = block.fields?.[name];
    return Array.isArray(field) ? (field[1] || field[0] || fallback) : fallback;
  }

  async evaluate(target, block, thread, depth = 0) {
    if (!block || depth > 80 || thread.cancelled) return 0;
    const v = name => this.value(target, block, name, thread, depth + 1);
    const a = async name => await v(name);
    switch (block.opcode) {
      case 'math_number': return this.constructor.number(this.field(block, 'NUM', 0));
      case 'math_integer': return Math.floor(this.constructor.number(this.field(block, 'NUM', 0)));
      case 'math_whole_number': return Math.floor(this.constructor.number(this.field(block, 'NUM', 0)));
      case 'text': return this.field(block, 'TEXT', '');
      case 'logic_boolean': return this.field(block, 'BOOL') === 'TRUE';
      case 'logic_null': return null;
      case 'colour_picker': return this.field(block, 'COLOUR', '#000000');
      case 'sound_sounds_menu': return this.field(block,'SOUND_MENU','');
      case 'motion_goto_menu': return this.field(block,'TO','');
      case 'motion_pointtowards_menu': return this.field(block,'TOWARDS','');
      case 'looks_costume': return this.field(block,'COSTUME','');
      case 'looks_backdrops': return this.field(block,'BACKDROP','');
      case 'event_broadcast_menu': return this.field(block,'BROADCAST_OPTION','');
      case 'control_create_clone_of_menu': return this.field(block,'CLONE_OPTION','');
      case 'sensing_keyoptions': return this.field(block,'KEY_OPTION','');
      case 'sensing_touchingobjectmenu': return this.field(block,'TOUCHINGOBJECTMENU','');
      case 'sensing_distancetomenu': return this.field(block,'DISTANCETOMENU','');
      case 'sensing_of_object_menu': return this.field(block,'OBJECT','');
      case 'sound_volume': return target.volume;
      case 'data_variable': return this.getVariable(target, this.fieldId(block, 'VARIABLE')).value;
      case 'data_listcontents': return this.getList(target, this.fieldId(block, 'LIST')).value.join(' ');
      case 'data_lengthoflist': return this.getList(target, this.fieldId(block, 'LIST')).value.length;
      case 'data_itemoflist': { const list=this.getList(target,this.fieldId(block,'LIST')).value,index=this.listIndex(await a('INDEX'),list.length); return index<0?'':list[index]; }
      case 'data_itemnumoflist': { const list=this.getList(target,this.fieldId(block,'LIST')).value,item=this.constructor.text(await a('ITEM')); return list.findIndex(value=>this.constructor.text(value)===item)+1; }
      case 'data_listcontainsitem': { const list=this.getList(target,this.fieldId(block,'LIST')).value,item=this.constructor.text(await a('ITEM')).toLowerCase(); return list.some(value=>this.constructor.text(value).toLowerCase()===item); }
      case 'operator_add': case 'math_add': return this.constructor.number(await a('NUM1')) + this.constructor.number(await a('NUM2'));
      case 'operator_subtract': case 'math_subtract': return this.constructor.number(await a('NUM1')) - this.constructor.number(await a('NUM2'));
      case 'operator_multiply': case 'math_multiply': return this.constructor.number(await a('NUM1')) * this.constructor.number(await a('NUM2'));
      case 'operator_divide': case 'math_divide': return this.constructor.number(await a('NUM1')) / this.constructor.number(await a('NUM2'));
      case 'math_modulo': case 'operator_mod': {
        const x = this.constructor.number(await a('NUM1')), y = this.constructor.number(await a('NUM2'));
        return y === 0 ? 0 : ((x % y) + y) % y;
      }
      case 'math_round': case 'operator_round': return Math.round(this.constructor.number(await a('NUM')));
      case 'math_random': case 'operator_random': {
        const x = this.constructor.number(await a('FROM')), y = this.constructor.number(await a('TO'));
        return Math.floor(Math.random() * (Math.abs(y - x) + 1)) + Math.min(x, y);
      }
      case 'math_single': case 'operator_mathop': {
        const n = this.constructor.number(await a('NUM')), op = this.field(block, 'OPERATOR');
        const f = {abs:Math.abs, floor:Math.floor, ceiling:Math.ceil, sqrt:Math.sqrt, ln:Math.log, log:Math.log10, 'e ^':Math.exp, '10 ^':x=>10**x,
          sin:x=>Math.sin(x*Math.PI/180), cos:x=>Math.cos(x*Math.PI/180), tan:x=>Math.tan(x*Math.PI/180),
          asin:x=>Math.asin(x)*180/Math.PI, acos:x=>Math.acos(x)*180/Math.PI, atan:x=>Math.atan(x)*180/Math.PI}[op];
        return f ? f(n) : 0;
      }
      case 'operator_equals': {
        const left=await a('OPERAND1'), right=await a('OPERAND2');
        const leftNumber=Number(left), rightNumber=Number(right);
        if(this.constructor.text(left).trim()!=='' && this.constructor.text(right).trim()!=='' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber===rightNumber;
        return this.constructor.text(left).toLowerCase()===this.constructor.text(right).toLowerCase();
      }
      case 'operator_gt': return this.constructor.number(await a('OPERAND1')) > this.constructor.number(await a('OPERAND2'));
      case 'operator_lt': return this.constructor.number(await a('OPERAND1')) < this.constructor.number(await a('OPERAND2'));
      case 'operator_and': return this.constructor.truthy(await a('OPERAND1')) && this.constructor.truthy(await a('OPERAND2'));
      case 'operator_or': return this.constructor.truthy(await a('OPERAND1')) || this.constructor.truthy(await a('OPERAND2'));
      case 'operator_not': return !this.constructor.truthy(await a('OPERAND'));
      case 'operator_join': return this.constructor.text(await a('STRING1')) + this.constructor.text(await a('STRING2'));
      case 'operator_length': return this.constructor.text(await a('STRING')).length;
      case 'operator_contains': return this.constructor.text(await a('STRING1')).toLowerCase().includes(this.constructor.text(await a('STRING2')).toLowerCase());
      case 'operator_letter_of': {
        const str = Array.from(this.constructor.text(await a('STRING'))), index = Math.floor(this.constructor.number(await a('LETTER'))) - 1;
        return str[index] || '';
      }
      case 'operator_of': case 'sensing_of': {
        const property = this.field(block, 'PROPERTY').toLowerCase().replace(/[\\s_]/g,'');
        const object = this.constructor.text(await a('OBJECT'));
        const other = this.targets.find(item => item.name === object);
        if (!other) return 0;
        return ({xposition:other.x, yposition:other.y, direction:other.direction, costume:other.currentCostume + 1, size:other.size, volume:other.volume})[property] ?? 0;
      }
      case 'sensing_touchingobject': {
        const who=this.constructor.text(await a('TOUCHINGOBJECTMENU'));
        if(who==='_mouse_') return this.host.hitTest ? this.host.hitTest(target,this.mouse.x,this.mouse.y) : false;
        if(who==='_edge_') return target.x < -this.stageWidth/2 || target.x > this.stageWidth/2 || target.y < -this.stageHeight/2 || target.y > this.stageHeight/2;
        const other=this.targets.find(item=>item.name===who);
        return !!other && other!==target && Math.hypot(target.x-other.x,target.y-other.y)<42;
      }
      case 'motion_xposition': return target.x;
      case 'motion_yposition': return target.y;
      case 'motion_direction': return target.direction;
      case 'looks_size': return target.size;
      case 'looks_costumenumbername': return this.field(block,'NUMBER_NAME')==='name' ? (target.costumes[target.currentCostume]?.name || '') : target.currentCostume+1;
      case 'looks_backdropnumbername': return this.field(block,'NUMBER_NAME')==='name' ? (this.stage.costumes[this.stage.currentCostume]?.name || '') : this.stage.currentCostume+1;
      case 'sensing_mousex': return this.mouse.x;
      case 'sensing_mousey': return this.mouse.y;
      case 'sensing_mousedown': return this.mouse.down;
      case 'sensing_keypressed': return this.keys.has(this.constructor.keyName(await a('KEY_OPTION')));
      case 'sensing_timer': return (performance.now() - this.startedAt) / 1000;
      case 'sensing_answer': return this.answer ?? '';
      case 'sensing_username': return this.username || 'player';
      case 'sensing_current': {
        const d = new Date(), unit = this.field(block, 'CURRENTMENU');
        return ({YEAR:d.getFullYear(), MONTH:d.getMonth()+1, DATE:d.getDate(), DAYOFWEEK:d.getDay()+1, HOUR:d.getHours(), MINUTE:d.getMinutes(), SECOND:d.getSeconds()})[unit] ?? 0;
      }
      case 'sensing_dayssince2000': return (Date.now() - Date.UTC(2000,0,1)) / 86400000;
      case 'sensing_distanceto': {
        const who = this.constructor.text(await a('DISTANCETOMENU'));
        const other = this.targets.find(item => item.name === who);
        return other ? Math.hypot(other.x-target.x, other.y-target.y) : Math.hypot(this.mouse.x-target.x,this.mouse.y-target.y);
      }
      default: {
        const extension=this.extensions[block.opcode];
        if(extension && typeof extension.reporter==='function') return await extension.reporter({runtime:this,target,block,thread,input:name=>this.value(target,block,name,thread,depth+1),field:name=>this.field(block,name)});
        if (this.host.evaluateExtension) return await this.host.evaluateExtension(block.opcode, {target, block, runtime:this});
        this.host.onUnsupported?.(block.opcode, target);
        return 0;
      }
    }
  }

  async executeStack(target, firstId, thread) {
    let id = firstId;
    const visited = new Set();
    let steps = 0;
    while (id && this.running && !thread.cancelled && target.alive && !visited.has(id)) {
      if (++steps > 1000000) throw new Error('Script instruction safety limit exceeded');
      visited.add(id);
      const block = target.blocks[id];
      if (!block) break;
      await this.executeBlock(target, block, thread);
      id = block.next;
      if ((steps & 63) === 0) await this.yield();
    }
  }

  async substack(target, block, name, thread) {
    const input = block.inputs?.[name], candidate = input && (input[1] || input[2]);
    if (typeof candidate === 'string') await this.executeStack(target, candidate, thread);
  }

  async executeBlock(target, block, thread) {
    const previousX = target.x, previousY = target.y;
    const v = name => this.value(target, block, name, thread);
    const n = async name => this.constructor.number(await v(name));
    switch (block.opcode) {
      case 'motion_movesteps': {
        const radians = target.direction * Math.PI / 180, distance = await n('STEPS');
        target.x += Math.sin(radians) * distance; target.y += Math.cos(radians) * distance; this.fence(target); break;
      }
      case 'motion_turnright': target.direction += await n('DEGREES'); break;
      case 'motion_turnleft': target.direction -= await n('DEGREES'); break;
      case 'motion_goto': {
        const dest = this.constructor.text(await v('TO'));
        const other = this.targets.find(item => item.name === dest);
        if (dest === '_mouse_') { target.x=this.mouse.x; target.y=this.mouse.y; }
        else if (dest === '_random_') { target.x=Math.random()*this.stageWidth-this.stageWidth/2; target.y=Math.random()*this.stageHeight-this.stageHeight/2; }
        else if (other) { target.x=other.x; target.y=other.y; }
        this.fence(target); break;
      }
      case 'motion_gotoxy': target.x=await n('X'); target.y=await n('Y'); this.fence(target); break;
      case 'motion_glidesecstoxy': {
        const duration = Math.max(0, await n('SECS')), sx=target.x, sy=target.y, x=await n('X'), y=await n('Y'), start=performance.now();
        while (this.running && !thread.cancelled) {
          const t = duration ? this.constructor.clamp((performance.now()-start)/(duration*1000),0,1) : 1;
          const oldX=target.x, oldY=target.y;
          target.x=sx+(x-sx)*t; target.y=sy+(y-sy)*t; this.fence(target);
          if(target.penDown) this.host.penLine?.(target,oldX,oldY,target.x,target.y);
          this.host.onTargetChange?.(target, block.opcode);
          if (t >= 1) break;
          await this.yield();
        }
        break;
      }
      case 'motion_setx': target.x=await n('X'); this.fence(target); break;
      case 'motion_sety': target.y=await n('Y'); this.fence(target); break;
      case 'motion_changexby': target.x+=await n('DX'); this.fence(target); break;
      case 'motion_changeyby': target.y+=await n('DY'); this.fence(target); break;
      case 'motion_pointindirection': target.direction=await n('DIRECTION'); break;
      case 'motion_pointtowards': {
        const dest=this.constructor.text(await v('TOWARDS')), other=this.targets.find(item=>item.name===dest);
        const x=dest==='_mouse_'?this.mouse.x:other?.x, y=dest==='_mouse_'?this.mouse.y:other?.y;
        if (x!==undefined) target.direction=Math.atan2(x-target.x,y-target.y)*180/Math.PI;
        break;
      }
      case 'motion_ifonedgebounce': {
        let dx=Math.sin(target.direction*Math.PI/180),dy=Math.cos(target.direction*Math.PI/180);
        if(target.x>this.stageWidth/2-20||target.x< -this.stageWidth/2+20)dx=-dx;
        if(target.y>this.stageHeight/2-20||target.y< -this.stageHeight/2+20)dy=-dy;
        target.x=this.constructor.clamp(target.x,-this.stageWidth/2+20,this.stageWidth/2-20);target.y=this.constructor.clamp(target.y,-this.stageHeight/2+20,this.stageHeight/2-20);
        target.direction=Math.atan2(dx,dy)*180/Math.PI;
        break;
      }
      case 'motion_setrotationstyle': target.rotationStyle=this.field(block,'STYLE','all around'); break;
      case 'looks_show': target.visible=true; break;
      case 'looks_hide': target.visible=false; break;
      case 'looks_setsizeto': target.size=await n('SIZE'); break;
      case 'looks_changesizeby': target.size+=await n('CHANGE'); break;
      case 'looks_nextcostume': target.currentCostume=(target.currentCostume+1)%Math.max(1,target.costumes.length); break;
      case 'looks_switchbackdropto': case 'looks_switchbackdroptoandwait': {
        if (target.isStage) {
          const name=this.constructor.text(await v('BACKDROP')), index=target.costumes.findIndex(costume=>costume.name===name);
          if(index>=0) target.currentCostume=index;
          const jobs=[];
          for(const sprite of this.targets) for(const hat of Object.values(sprite.blocks)) {
            if(hat?.topLevel && hat.opcode==='event_whenbackdropswitchesto' && this.constructor.text(hat.fields?.BACKDROP?.[0])===name) jobs.push(this.launch(sprite,hat));
          }
          if(block.opcode.endsWith('andwait')) await Promise.all(jobs);
        }
        break;
      }
      case 'looks_nextbackdrop': if(target.isStage) {
        target.currentCostume=(target.currentCostume+1)%Math.max(1,target.costumes.length);
        const name=target.costumes[target.currentCostume]?.name;
        for(const sprite of this.targets) for(const hat of Object.values(sprite.blocks)) if(hat?.topLevel&&hat.opcode==='event_whenbackdropswitchesto'&&this.constructor.text(hat.fields?.BACKDROP?.[0])===name)this.launch(sprite,hat);
      } break;
      case 'looks_gotofrontback': target.layerOrder= this.field(block,'FRONT_BACK')==='front'?Math.max(...this.targets.map(t=>t.layerOrder))+1:Math.min(...this.targets.map(t=>t.layerOrder))-1; break;
      case 'looks_switchcostumeto': {
        const name=this.constructor.text(await v('COSTUME')), index=target.costumes.findIndex(c=>c.name===name);
        if (index>=0) target.currentCostume=index;
        break;
      }
      case 'looks_say': target.bubble={type:'say',text:this.constructor.text(await v('MESSAGE'))}; break;
      case 'looks_think': target.bubble={type:'think',text:this.constructor.text(await v('MESSAGE'))}; break;
      case 'looks_sayforsecs': case 'looks_thinkforsecs': {
        target.bubble={type:block.opcode.includes('think')?'think':'say',text:this.constructor.text(await v('MESSAGE'))};
        this.host.onTargetChange?.(target, block.opcode);
        await this.wait(await n('SECS'),thread); target.bubble=null;
        this.host.onTargetChange?.(target, block.opcode); break;
      }
      case 'looks_cleargraphiceffects': target.effects={}; break;
      case 'looks_changeeffectby': {
        const effect=this.field(block,'EFFECT'); target.effects[effect]=this.constructor.number(target.effects[effect])+await n('CHANGE'); break;
      }
      case 'looks_seteffectto': target.effects[this.field(block,'EFFECT')]=await n('VALUE'); break;
      case 'looks_goforwardbackwardlayers': target.layerOrder += (this.field(block,'FORWARD_BACKWARD')==='forward'?1:-1)*await n('NUM'); break;
      case 'pen_clear': case 'pen_eraseAll': this.host.penClear?.(); break;
      case 'pen_penDown': target.penDown=true; break;
      case 'pen_penUp': target.penDown=false; break;
      case 'pen_setPenColorToColor': target.penColor=this.constructor.text(await v('COLOR')); break;
      case 'pen_setPenSizeTo': target.penSize=this.constructor.clamp(await n('SIZE'),0,100); break;
      case 'pen_changePenSizeBy': target.penSize=this.constructor.clamp(target.penSize+await n('SIZE'),0,100); break;
      case 'pen_stamp': this.host.penStamp?.(target); break;
      case 'sound_play': case 'sound_playuntildone': {
        const name=this.constructor.text(await v('SOUND_MENU'));
        const playback=this.host.playSound ? this.host.playSound(target,name) : Promise.resolve();
        if(block.opcode==='sound_playuntildone') await playback;
        break;
      }
      case 'sound_setvolumeto': case 'sound_setvolume': target.volume=this.constructor.clamp(await n('VOLUME'),0,100); break;
      case 'sound_changevolumeby': case 'sound_changevolume': target.volume=this.constructor.clamp(target.volume+await n('VOLUME'),0,100); break;
      case 'sound_stopallsounds': this.host.stopAllSounds?.(); break;
      case 'sensing_resettimer': this.startedAt=performance.now(); break;
      case 'sensing_askandwait': this.answer = await (this.host.ask ? this.host.ask(this.constructor.text(await v('QUESTION'))) : (typeof prompt === 'function' ? prompt(this.constructor.text(await v('QUESTION'))) : '')); break;
      case 'data_setvariableto': this.setVariable(target,this.fieldId(block,'VARIABLE'),await v('VALUE')); break;
      case 'data_changevariableby': {
        const id=this.field(block,'VARIABLE'), current=this.getVariable(target,id).value;
        this.setVariable(target,id,this.constructor.number(current)+await n('VALUE')); break;
      }
      case 'data_addtolist': this.getList(target,this.fieldId(block,'LIST')).value.push(await v('ITEM')); break;
      case 'data_deleteoflist': {
        const list=this.getList(target,this.fieldId(block,'LIST')).value, index=this.listIndex(await v('INDEX'),list.length);
        if (index>=0) list.splice(index,1); break;
      }
      case 'data_deletealloflist': this.getList(target,this.field(block,'LIST')).value.length=0; break;
      case 'data_insertatlist': {
        const list=this.getList(target,this.field(block,'LIST')).value, index=this.listIndex(await v('INDEX'),list.length,true);
        list.splice(index,0,await v('ITEM')); break;
      }
      case 'data_replaceitemoflist': {
        const list=this.getList(target,this.field(block,'LIST')).value, index=this.listIndex(await v('INDEX'),list.length);
        if (index>=0) list[index]=await v('ITEM'); break;
      }
      case 'control_wait': await this.wait(await n('DURATION'),thread); break;
      case 'control_repeat': {
        const count=this.constructor.clamp(Math.floor(await n('TIMES')),0,100000);
        for(let i=0;i<count && this.running && !thread.cancelled;i++){await this.substack(target,block,'SUBSTACK',thread);await this.yield();}
        break;
      }
      case 'control_forever':
        while(this.running && !thread.cancelled && target.alive){await this.substack(target,block,'SUBSTACK',thread);await this.yield();}
        break;
      case 'control_if': if(this.constructor.truthy(await v('CONDITION'))) await this.substack(target,block,'SUBSTACK',thread); break;
      case 'control_if_else': await this.substack(target,block,this.constructor.truthy(await v('CONDITION'))?'SUBSTACK':'SUBSTACK2',thread); break;
      case 'control_repeat_until':
        while(this.running && !thread.cancelled && !this.constructor.truthy(await v('CONDITION'))){await this.substack(target,block,'SUBSTACK',thread);await new Promise(resolve=>setTimeout(resolve,16));}
        break;
      case 'control_wait_until':
        while(this.running && !thread.cancelled && !this.constructor.truthy(await v('CONDITION'))) await new Promise(resolve=>setTimeout(resolve,16));
        break;
      case 'control_stop': {
        const option=this.field(block,'STOP_OPTION','all');
        if(option==='all') this.stopAll(); else if(option==='this script') thread.cancelled=true; else this.stopTarget(target);
        break;
      }
      case 'event_broadcast': await this.broadcast(this.constructor.text(await v('BROADCAST_INPUT')),false); break;
      case 'event_broadcastandwait': await this.broadcast(this.constructor.text(await v('BROADCAST_INPUT')),true); break;
      case 'control_create_clone_of': {
        const name=this.constructor.text(await v('CLONE_OPTION'));
        const original=name==='_myself_'?target:this.targets.find(t=>t.name===name);
        if(original) this.createClone(original);
        break;
      }
      case 'control_delete_this_clone':
        if(!target.isOriginal){target.alive=false;this.stopTarget(target);this.host.onDeleteClone?.(target);}
        break;
      case 'procedures_call': {
        const proccode=this.field(block,'proccode');
        const definition=Object.values(target.blocks).find(item=>item.opcode==='procedures_definition' && target.blocks[item.inputs?.custom_block?.[1]]?.mutation?.proccode===proccode);
        if(definition) await this.executeStack(target,definition.next,thread);
        break;
      }
      default: {
        const extension=this.extensions[block.opcode];
        if(extension && typeof extension.command==='function') {
          await extension.command({runtime:this,target,block,thread,input:name=>this.value(target,block,name,thread),field:name=>this.field(block,name)});
          break;
        }
        if (this.host.executeExtension && await this.host.executeExtension(block.opcode, {target, block, runtime:this})) break;
        if (!block.opcode.startsWith('event_') && !block.opcode.startsWith('procedures_')) this.host.onUnsupported?.(block.opcode,target);
        break;
      }
    }
    if(target.penDown && (target.x!==previousX || target.y!==previousY)) this.host.penLine?.(target,previousX,previousY,target.x,target.y);
    this.host.onTargetChange?.(target,block.opcode);
  }

  listIndex(value, length, allowEnd = false) {
    const s=this.constructor.text(value).toLowerCase();
    if(s==='last') return allowEnd?length:length-1;
    if(s==='random'||s==='any') return length?Math.floor(Math.random()*length):0;
    const n=Math.floor(this.constructor.number(value))-1;
    return allowEnd?this.constructor.clamp(n,0,length):n>=0&&n<length?n:-1;
  }

  async broadcast(name, wait) {
    const jobs=[];
    for(const target of this.targets) {
      for(const block of Object.values(target.blocks)) {
        if(block?.topLevel && block.opcode==='event_whenbroadcastreceived' && this.constructor.text(block.fields?.BROADCAST_OPTION?.[0])===name) jobs.push(this.launch(target,block));
      }
    }
    if(wait) await Promise.all(jobs);
  }

  createClone(original) {
    if(this.clones.length>=this.maxClones) return null;
    const clone={...original,id:original.id+'-clone-'+(this.clones.length+1),variables:Object.fromEntries(Object.entries(original.variables).map(([k,v])=>[k,{...v}])),lists:Object.fromEntries(Object.entries(original.lists).map(([k,v])=>[k,{...v,value:v.value.slice()}])),isOriginal:false,alive:true,clones:[],effects:{...original.effects}};
    this.clones.push(clone);this.targets.push(clone);this.host.onClone?.(clone);
    for(const block of Object.values(clone.blocks)) if(block?.topLevel&&block.opcode==='control_start_as_clone') this.launch(clone,block);
    return clone;
  }

  keyDown(key) {
    const normalized=this.constructor.keyName(key);this.keys.add(normalized);
    this.runHat('event_whenkeypressed',block=>this.constructor.keyName(block.fields?.KEY_OPTION?.[0])===normalized);
  }
  keyUp(key) {this.keys.delete(this.constructor.keyName(key));}
  pointerMove(x,y) {this.mouse.x=this.constructor.number(x);this.mouse.y=this.constructor.number(y);}
  pointerDown(x,y) {this.pointerMove(x,y);this.mouse.down=true;this.runHat('event_whenthisspriteclicked',(_b,t)=>!t.isStage&&this.host.hitTest?.(t,x,y));this.runHat('event_whenstageclicked',(_b,t)=>t.isStage);}
  pointerUp() {this.mouse.down=false;}
}


/**
 * Serialize the native interpreter into a self-contained browser script.
 * All helpers are static class methods so minification cannot break source serialization.
 */
export const getNativeRuntimeSource = () => [
  'const NativeRuntime = ' + NativeRuntime.toString() + ';',
  'const NATIVE_RUNTIME_SUPPORTED = new Set(' + JSON.stringify([...NATIVE_RUNTIME_SUPPORTED]) + ');'
].join('\n');
