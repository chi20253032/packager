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
const keyName = value => ({
  ' ':'space', 'arrowup':'up', 'arrowdown':'down', 'arrowleft':'left',
  'arrowright':'right', 'enter':'enter', 'escape':'escape'
})[text(value).toLowerCase()] || text(value).toLowerCase();

export class NativeRuntime {
  constructor(project, host = {}) {
    if (!project || !Array.isArray(project.targets)) throw new Error('Invalid SB3 project: targets missing');
    this.project = project;
    this.host = host;
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
      x: number(raw.x), y: number(raw.y), direction: number(raw.direction || 90),
      size: number(raw.size || 100), visible: raw.visible !== false,
      draggable: !!raw.draggable, rotationStyle: raw.rotationStyle || 'all around',
      currentCostume: number(raw.currentCostume), costumes: raw.costumes || [],
      volume: number(raw.volume ?? 100), layerOrder: number(raw.layerOrder ?? index),
      effects: {...(raw.effects || {})}, clones: [], alive: true, bubble: null,
      timer: 0, touching: Object.create(null), isOriginal: true
    };
  }

  start() {
    this.stopAll();
    this.running = true;
    this.startedAt = performance.now();
    this.targets.forEach(target => { target.alive = true; });
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
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  async wait(seconds, thread) {
    const end = performance.now() + Math.max(0, number(seconds) * 1000);
    while (this.running && !thread.cancelled && performance.now() < end) await this.yield();
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
      case 'math_number': return number(this.field(block, 'NUM', 0));
      case 'math_integer': return Math.floor(number(this.field(block, 'NUM', 0)));
      case 'math_whole_number': return Math.floor(number(this.field(block, 'NUM', 0)));
      case 'text': return this.field(block, 'TEXT', '');
      case 'logic_boolean': return this.field(block, 'BOOL') === 'TRUE';
      case 'logic_null': return null;
      case 'colour_picker': return this.field(block, 'COLOUR', '#000000');
      case 'data_variable': return this.getVariable(target, this.field(block, 'VARIABLE', '')).value;
      case 'data_listcontents': return this.getList(target, this.field(block, 'LIST', '')).value.join(' ');
      case 'data_listindexall': return this.getList(target, this.field(block, 'LIST', '')).value.length;
      case 'operator_add': case 'operator_add': return number(await a('NUM1')) + number(await a('NUM2'));
      case 'math_add': return number(await a('NUM1')) + number(await a('NUM2'));
      case 'math_subtract': return number(await a('NUM1')) - number(await a('NUM2'));
      case 'math_multiply': return number(await a('NUM1')) * number(await a('NUM2'));
      case 'math_divide': return number(await a('NUM1')) / number(await a('NUM2'));
      case 'math_modulo': case 'operator_mod': {
        const x = number(await a('NUM1')), y = number(await a('NUM2'));
        return y === 0 ? 0 : ((x % y) + y) % y;
      }
      case 'math_round': case 'operator_round': return Math.round(number(await a('NUM')));
      case 'math_random': case 'operator_random': {
        const x = number(await a('FROM')), y = number(await a('TO'));
        return Math.floor(Math.random() * (Math.abs(y - x) + 1)) + Math.min(x, y);
      }
      case 'math_single': case 'operator_mathop': {
        const n = number(await a('NUM')), op = this.field(block, 'OPERATOR');
        const f = {abs:Math.abs, floor:Math.floor, ceiling:Math.ceil, sqrt:Math.sqrt, ln:Math.log, log:Math.log10, 'e ^':Math.exp, '10 ^':x=>10**x,
          sin:x=>Math.sin(x*Math.PI/180), cos:x=>Math.cos(x*Math.PI/180), tan:x=>Math.tan(x*Math.PI/180),
          asin:x=>Math.asin(x)*180/Math.PI, acos:x=>Math.acos(x)*180/Math.PI, atan:x=>Math.atan(x)*180/Math.PI}[op];
        return f ? f(n) : 0;
      }
      case 'operator_equals': return text(await a('OPERAND1')).toLowerCase() === text(await a('OPERAND2')).toLowerCase();
      case 'operator_gt': return number(await a('OPERAND1')) > number(await a('OPERAND2'));
      case 'operator_lt': return number(await a('OPERAND1')) < number(await a('OPERAND2'));
      case 'operator_and': return truthy(await a('OPERAND1')) && truthy(await a('OPERAND2'));
      case 'operator_or': return truthy(await a('OPERAND1')) || truthy(await a('OPERAND2'));
      case 'operator_not': return !truthy(await a('OPERAND'));
      case 'operator_join': return text(await a('STRING1')) + text(await a('STRING2'));
      case 'operator_length': return text(await a('STRING')).length;
      case 'operator_contains': return text(await a('STRING1')).toLowerCase().includes(text(await a('STRING2')).toLowerCase());
      case 'operator_letter_of': {
        const str = text(await a('STRING')), index = Math.floor(number(await a('LETTER'))) - 1;
        return str[index] || '';
      }
      case 'operator_of': {
        const property = this.field(block, 'PROPERTY');
        const object = text(await a('OBJECT'));
        const other = this.targets.find(item => item.name === object);
        if (!other) return 0;
        return ({xposition:other.x, yposition:other.y, direction:other.direction, costume:other.currentCostume + 1, size:other.size, volume:other.volume})[property] ?? 0;
      }
      case 'sensing_mousex': return this.mouse.x;
      case 'sensing_mousey': return this.mouse.y;
      case 'sensing_mousedown': return this.mouse.down;
      case 'sensing_keypressed': return this.keys.has(keyName(await a('KEY_OPTION')));
      case 'sensing_timer': return (performance.now() - this.startedAt) / 1000;
      case 'sensing_answer': return this.answer ?? '';
      case 'sensing_username': return this.username || 'player';
      case 'sensing_current': {
        const d = new Date(), unit = this.field(block, 'CURRENTMENU');
        return ({YEAR:d.getFullYear(), MONTH:d.getMonth()+1, DATE:d.getDate(), DAYOFWEEK:(d.getDay()+6)%7+1, HOUR:d.getHours(), MINUTE:d.getMinutes(), SECOND:d.getSeconds()})[unit] ?? 0;
      }
      case 'sensing_dayssince2000': return (Date.now() - Date.UTC(2000,0,1)) / 86400000;
      case 'sensing_distanceto': {
        const who = text(await a('DISTANCETOMENU'));
        const other = this.targets.find(item => item.name === who);
        return other ? Math.hypot(other.x-target.x, other.y-target.y) : Math.hypot(this.mouse.x-target.x,this.mouse.y-target.y);
      }
      default:
        this.host.onUnsupported?.(block.opcode, target);
        return 0;
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
    const v = name => this.value(target, block, name, thread);
    const n = async name => number(await v(name));
    switch (block.opcode) {
      case 'motion_movesteps': {
        const radians = target.direction * Math.PI / 180, distance = await n('STEPS');
        target.x += Math.sin(radians) * distance; target.y += Math.cos(radians) * distance; break;
      }
      case 'motion_turnright': target.direction += await n('DEGREES'); break;
      case 'motion_turnleft': target.direction -= await n('DEGREES'); break;
      case 'motion_goto': {
        const dest = text(await v('TO'));
        const other = this.targets.find(item => item.name === dest);
        if (dest === '_mouse_') { target.x=this.mouse.x; target.y=this.mouse.y; }
        else if (other) { target.x=other.x; target.y=other.y; }
        break;
      }
      case 'motion_gotoxy': target.x=await n('X'); target.y=await n('Y'); break;
      case 'motion_glidesecstoxy': {
        const duration = Math.max(0, await n('SECS')), sx=target.x, sy=target.y, x=await n('X'), y=await n('Y'), start=performance.now();
        while (this.running && !thread.cancelled) {
          const t = duration ? clamp((performance.now()-start)/(duration*1000),0,1) : 1;
          target.x=sx+(x-sx)*t; target.y=sy+(y-sy)*t;
          if (t >= 1) break;
          await this.yield();
        }
        break;
      }
      case 'motion_setx': target.x=await n('X'); break;
      case 'motion_sety': target.y=await n('Y'); break;
      case 'motion_changexby': target.x+=await n('DX'); break;
      case 'motion_changeyby': target.y+=await n('DY'); break;
      case 'motion_pointindirection': target.direction=await n('DIRECTION'); break;
      case 'motion_pointtowards': {
        const dest=text(await v('TOWARDS')), other=this.targets.find(item=>item.name===dest);
        const x=dest==='_mouse_'?this.mouse.x:other?.x, y=dest==='_mouse_'?this.mouse.y:other?.y;
        if (x!==undefined) target.direction=Math.atan2(x-target.x,y-target.y)*180/Math.PI;
        break;
      }
      case 'motion_ifonedgebounce': this.host.bounce?.(target); break;
      case 'looks_show': target.visible=true; break;
      case 'looks_hide': target.visible=false; break;
      case 'looks_setsizeto': target.size=await n('SIZE'); break;
      case 'looks_changesizeby': target.size+=await n('CHANGE'); break;
      case 'looks_nextcostume': target.currentCostume=(target.currentCostume+1)%Math.max(1,target.costumes.length); break;
      case 'looks_switchcostumeto': {
        const name=text(await v('COSTUME')), index=target.costumes.findIndex(c=>c.name===name);
        if (index>=0) target.currentCostume=index;
        break;
      }
      case 'looks_say': target.bubble={type:'say',text:text(await v('MESSAGE'))}; break;
      case 'looks_think': target.bubble={type:'think',text:text(await v('MESSAGE'))}; break;
      case 'looks_sayforsecs': case 'looks_thinkforsecs': {
        target.bubble={type:block.opcode.includes('think')?'think':'say',text:text(await v('MESSAGE'))};
        await this.wait(await n('SECS'),thread); target.bubble=null; break;
      }
      case 'looks_cleargraphiceffects': target.effects={}; break;
      case 'looks_changeeffectby': {
        const effect=this.field(block,'EFFECT'); target.effects[effect]=number(target.effects[effect])+await n('CHANGE'); break;
      }
      case 'looks_seteffectto': target.effects[this.field(block,'EFFECT')]=await n('VALUE'); break;
      case 'looks_gotofrontback': target.layerOrder= this.field(block,'FRONT_BACK')==='front'?Math.max(...this.targets.map(t=>t.layerOrder))+1:Math.min(...this.targets.map(t=>t.layerOrder))-1; break;
      case 'looks_goforwardbackwardlayers': target.layerOrder += (this.field(block,'FORWARD_BACKWARD')==='forward'?1:-1)*await n('NUM'); break;
      case 'sound_setvolume': target.volume=await n('VOLUME'); break;
      case 'sound_changevolume': target.volume+=await n('VOLUME'); break;
      case 'sound_stopallsounds': this.host.stopAllSounds?.(); break;
      case 'data_setvariableto': this.setVariable(target,this.fieldId(block,'VARIABLE'),await v('VALUE')); break;
      case 'data_changevariableby': {
        const id=this.field(block,'VARIABLE'), current=this.getVariable(target,id).value;
        this.setVariable(target,id,number(current)+await n('VALUE')); break;
      }
      case 'data_addtolist': this.getList(target,this.fieldId(block,'LIST')).value.push(await v('ITEM')); break;
      case 'data_deleteoflist': {
        const list=this.getList(target,this.field(block,'LIST')).value, index=this.listIndex(await v('INDEX'),list.length);
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
        const count=clamp(Math.floor(await n('TIMES')),0,100000);
        for(let i=0;i<count && this.running && !thread.cancelled;i++){await this.substack(target,block,'SUBSTACK',thread);await this.yield();}
        break;
      }
      case 'control_forever':
        while(this.running && !thread.cancelled && target.alive){await this.substack(target,block,'SUBSTACK',thread);await this.yield();}
        break;
      case 'control_if': if(truthy(await v('CONDITION'))) await this.substack(target,block,'SUBSTACK',thread); break;
      case 'control_if_else': await this.substack(target,block,truthy(await v('CONDITION'))?'SUBSTACK':'SUBSTACK2',thread); break;
      case 'control_repeat_until':
        while(this.running && !thread.cancelled && !truthy(await v('CONDITION'))){await this.substack(target,block,'SUBSTACK',thread);await this.yield();}
        break;
      case 'control_wait_until':
        while(this.running && !thread.cancelled && !truthy(await v('CONDITION'))) await this.yield();
        break;
      case 'control_stop': {
        const option=this.field(block,'STOP_OPTION','all');
        if(option==='all') this.stopAll(); else if(option==='this script') thread.cancelled=true; else this.stopTarget(target);
        break;
      }
      case 'event_broadcast': await this.broadcast(text(await v('BROADCAST_INPUT')),false); break;
      case 'event_broadcastandwait': await this.broadcast(text(await v('BROADCAST_INPUT')),true); break;
      case 'control_create_clone_of': {
        const name=text(await v('CLONE_OPTION'));
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
      default:
        if (!block.opcode.startsWith('event_') && !block.opcode.startsWith('procedures_')) this.host.onUnsupported?.(block.opcode,target);
    }
    this.host.onTargetChange?.(target,block.opcode);
  }

  listIndex(value, length, allowEnd = false) {
    const s=text(value).toLowerCase();
    if(s==='last') return length-1;
    if(s==='random'||s==='any') return length?Math.floor(Math.random()*length):0;
    const n=Math.floor(number(value))-1;
    return allowEnd?clamp(n,0,length):n>=0&&n<length?n:-1;
  }

  async broadcast(name, wait) {
    const jobs=[];
    for(const target of this.targets) {
      for(const block of Object.values(target.blocks)) {
        if(block?.topLevel && block.opcode==='event_whenbroadcastreceived' && text(block.fields?.BROADCAST_OPTION?.[0])===name) jobs.push(this.launch(target,block));
      }
    }
    if(wait) await Promise.all(jobs);
  }

  createClone(original) {
    if(this.clones.length>=300) return null;
    const clone={...original,id:original.id+'-clone-'+(this.clones.length+1),variables:Object.fromEntries(Object.entries(original.variables).map(([k,v])=>[k,{...v}])),lists:Object.fromEntries(Object.entries(original.lists).map(([k,v])=>[k,{...v,value:v.value.slice()}])),isOriginal:false,alive:true,clones:[],effects:{...original.effects}};
    this.clones.push(clone);this.targets.push(clone);this.host.onClone?.(clone);
    for(const block of Object.values(clone.blocks)) if(block?.topLevel&&block.opcode==='control_start_as_clone') this.launch(clone,block);
    return clone;
  }

  keyDown(key) {
    const normalized=keyName(key);this.keys.add(normalized);
    this.runHat('event_whenkeypressed',block=>keyName(block.fields?.KEY_OPTION?.[0])===normalized);
  }
  keyUp(key) {this.keys.delete(keyName(key));}
  pointerMove(x,y) {this.mouse.x=number(x);this.mouse.y=number(y);}
  pointerDown(x,y) {this.pointerMove(x,y);this.mouse.down=true;this.runHat('event_whenthisspriteclicked',(_b,t)=>!t.isStage&&this.host.hitTest?.(t,x,y));this.runHat('event_whenstageclicked',(_b,t)=>t.isStage);}
  pointerUp() {this.mouse.down=false;}
}
