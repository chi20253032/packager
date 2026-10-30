/**
 * Native Scratch-to-JavaScript compiler.
 *
 * This compiler deliberately emits project-specific JavaScript rather than
 * shipping Scratch VM/Player code. The generated program uses a tiny canvas
 * runtime and a cooperative script scheduler. Unsupported opcodes are reported
 * before export so projects are never silently damaged.
 *
 * MPL-2.0
 */

const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const getField = (block, name, fallback = '') => {
  const field = block.fields && block.fields[name];
  return field ? field[0] : fallback;
};

const getInputBlock = (blocks, block, name) => {
  const input = block.inputs && block.inputs[name];
  if (!input) return null;
  const candidate = input[1] || input[2];
  if (typeof candidate === 'string') return blocks[candidate] || null;
  return null;
};

const getInputValue = (blocks, block, name, fallback = 0, diagnostics = null) => {
  const child = getInputBlock(blocks, block, name);
  if (child) return compileExpression(blocks, child, 0, diagnostics);
  const input = block.inputs && block.inputs[name];
  if (input && Array.isArray(input[1]) && input[1][1] !== undefined) return jsonForScript(input[1][1]);
  return jsonForScript(fallback);
};

const compileExpression = (blocks, block, depth = 0, diagnostics = null) => {
  if (!block || depth > 64) return '0';
  const next = (name) => compileExpression(blocks, getInputBlock(blocks, block, name), depth + 1, diagnostics);
  switch (block.opcode) {
    case 'math_number':
    case 'text':
      return jsonForScript(getField(block, 'NUM', getField(block, 'TEXT', '0')));
    case 'math_positive': return `(+(${next('NUM')}))`;
    case 'math_negative': return `(-(${next('NUM')}))`;
    case 'math_add': return `((+(${next('NUM1')}))+(+(${next('NUM2')})))`;
    case 'math_subtract': return `((+(${next('NUM1')}))-(+(${next('NUM2')})))`;
    case 'math_multiply': return `((+(${next('NUM1')}))*(+(${next('NUM2')})))`;
    case 'math_divide': return `((+(${next('NUM1')}))/(+(${next('NUM2')})))`;
    case 'operator_equals': return `(String(${next('OPERAND1')}).toLowerCase()===String(${next('OPERAND2')}).toLowerCase())`;
    case 'operator_gt': return `((+(${next('OPERAND1')}))>(+(${next('OPERAND2')})))`;
    case 'operator_lt': return `((+(${next('OPERAND1')}))<(+(${next('OPERAND2')})))`;
    case 'operator_and': return `(!!(${next('OPERAND1')})&&!!(${next('OPERAND2')}))`;
    case 'operator_or': return `(!!(${next('OPERAND1')})||!!(${next('OPERAND2')}))`;
    case 'operator_not': return `(!(${next('OPERAND')}))`;
    case 'operator_join': return `(String(${next('STRING1')})+String(${next('STRING2')}))`;
    case 'operator_mod': return `((+(${next('NUM1')})%+( ${next('NUM2')})))`;
    case 'operator_round': return `Math.round(+(${next('NUM')}))`;
    case 'operator_length': return `String(${next('STRING')}).length`;
    case 'operator_contains': return `String(${next('STRING1')}).toLowerCase().includes(String(${next('STRING2')}).toLowerCase())`;
    case 'operator_letter_of': return `String(${next('STRING')})[Math.max(0,(+(${next('LETTER')}))-1)]||''`;
    case 'operator_mathop': {
      const op = getField(block, 'OPERATOR');
      const operations = {
        abs: 'Math.abs', floor: 'Math.floor', ceiling: 'Math.ceil', sqrt: 'Math.sqrt',
        sin: '(n=>Math.sin(n*Math.PI/180))', cos: '(n=>Math.cos(n*Math.PI/180))', tan: '(n=>Math.tan(n*Math.PI/180))', asin: '(n=>Math.asin(n)*180/Math.PI)',
        acos: '(n=>Math.acos(n)*180/Math.PI)', atan: '(n=>Math.atan(n)*180/Math.PI)', ln: 'Math.log', 'log': 'Math.log10',
        'e ^': 'Math.exp', '10 ^': '(n=>Math.pow(10,n))'
      };
      if (operations[op]) return `${operations[op]}(+(${next('NUM')}))`;
      diagnostics && diagnostics.add(block.opcode);
      return '0';
    }
    case 'operator_random': return `(Math.floor(Math.random()*(Math.max(+(${next('FROM')}),+(${next('TO')}))-Math.min(+(${next('FROM')}),+(${next('TO')}))+1))+Math.min(+(${next('FROM')}),+(${next('TO')})))`;
    case 'sensing_mousex': return 'input.mouseX';
    case 'sensing_mousey': return 'input.mouseY';
    case 'sensing_mousedown': return 'input.mouseDown';
    case 'motion_xposition': return 'api.sprite.x';
    case 'motion_yposition': return 'api.sprite.y';
    case 'motion_direction': return 'api.direction';
    case 'sensing_keypressed': return `input.keys.has(String(${next('KEY_OPTION')}).toLowerCase())`;
    case 'data_variable': return `api.getVar(${jsonForScript(getField(block, 'VARIABLE'))})`;
    default:
      if (diagnostics) diagnostics.add(block.opcode);
      return '0';
  }
};

const compileStack = (blocks, firstId, diagnostics, depth = 0) => {
  if (depth > 64) return '';
  let output = '';
  let id = firstId;
  const visited = new Set();
  while (id && blocks[id] && !visited.has(id)) {
    visited.add(id);
    const block = blocks[id];
    const value = (name, fallback = 0) => getInputValue(blocks, block, name, fallback, diagnostics);
    const substack = (name) => compileStack(blocks, getInputBlock(blocks, block, name)?.id, diagnostics, depth + 1);
    switch (block.opcode) {
      case 'motion_movesteps': output += `await api.move(${value('STEPS')},0);\n`; break;
      case 'motion_turnright': output += `api.turn(${value('DEGREES')});\n`; break;
      case 'motion_turnleft': output += `api.turn(-(${value('DEGREES')}));\n`; break;
      case 'motion_gotoxy': output += `api.goto(${value('X')},${value('Y')});\n`; break;
      case 'motion_glidesecstoxy': output += `await api.glide(${value('SECS')},${value('X')},${value('Y')});\n`; break;
      case 'motion_ifonedgebounce': output += 'api.bounce();\n'; break;
      case 'motion_setx': output += `api.setX(${value('X')});\n`; break;
      case 'motion_sety': output += `api.setY(${value('Y')});\n`; break;
      case 'motion_changexby': output += `api.setX(api.sprite.x+(+(${value('DX')})));\n`; break;
      case 'motion_changeyby': output += `api.setY(api.sprite.y+(+(${value('DY')})));\n`; break;
      case 'motion_pointindirection': output += `api.direction=+(${value('DIRECTION')});\n`; break;
      case 'looks_show': output += 'api.sprite.visible=true;\n'; break;
      case 'looks_setsizeto': output += `api.sprite.size=+(${value('SIZE')});\n`; break;
      case 'looks_changesizeby': output += `api.sprite.size+=+(${value('CHANGE')});\n`; break;
      case 'looks_hide': output += 'api.sprite.visible=false;\n'; break;
      case 'looks_nextcostume': output += 'api.nextCostume();\n'; break;
      case 'looks_switchcostumeto': output += `api.switchCostume(${value('COSTUME', getField(block,'COSTUME'))});\n`; break;
      case 'data_setvariableto': output += `api.setVar(${jsonForScript(getField(block,'VARIABLE'))},${value('VALUE')});\n`; break;
      case 'data_changevariableby': output += `api.setVar(${jsonForScript(getField(block,'VARIABLE'))},(+api.getVar(${jsonForScript(getField(block,'VARIABLE'))})+(+(${value('VALUE')}))));\n`; break;
      case 'event_broadcast': output += `api.broadcast(${value('BROADCAST_INPUT',getField(block,'BROADCAST_OPTION'))});\n`; break;
      case 'event_broadcastandwait': output += `await api.broadcastAndWait(${value('BROADCAST_INPUT',getField(block,'BROADCAST_OPTION'))});\n`; break;
      case 'looks_say': output += `api.say(${value('MESSAGE','')});\n`; break;
      case 'looks_sayforsecs': output += `await api.sayFor(${value('MESSAGE','')},${value('SECS',2)});\n`; break;
      case 'control_wait': output += `await api.wait(${value('DURATION',1)});\n`; break;
      case 'control_repeat': output += `for(let n=0;n<Math.max(0,Math.min(10000,+(${value('TIMES')})));n++){\n${substack('SUBSTACK')}\n}\n`; break;
      case 'control_forever': output += `while(api.running){\n${substack('SUBSTACK')}\nawait api.yield();\n}\n`; break;
      case 'control_if': output += `if(${value('CONDITION')}){\n${substack('SUBSTACK')}\n}\n`; break;
      case 'control_if_else': output += `if(${value('CONDITION')}){\n${substack('SUBSTACK')}\n}else{\n${substack('SUBSTACK2')}\n}\n`; break;
      case 'control_stop': output += 'api.running=false;return;\n'; break;
      case 'event_whenflagclicked':
      case 'event_whenkeypressed':
      case 'event_whenthisspriteclicked':
      case 'event_whenstageclicked':
      case 'event_whenbroadcastreceived':
        break;
      default:
        if (!block.opcode.startsWith('event_')) diagnostics.add(block.opcode);
        break;
    }
    id = block.next;
  }
  return output;
};

export const compileNativeProject = (project) => {
  if (!project || !Array.isArray(project.targets)) throw new Error('Invalid Scratch project JSON: targets are missing.');
  const diagnostics = new Set();
  const sprites = project.targets.map((target, index) => {
    const blocks = target.blocks || {};
    const scripts = [];
    for (const block of Object.values(blocks)) {
      if (!block || block.shadow || block.topLevel !== true) continue;
      let trigger = null;
      if (block.opcode === 'event_whenflagclicked') trigger = {type:'flag'};
      if (block.opcode === 'event_whenkeypressed') trigger = {type:'key', key:getField(block,'KEY_OPTION').toLowerCase()};
      if (block.opcode === 'event_whenthisspriteclicked') trigger = {type:'click'};
      if (block.opcode === 'event_whenstageclicked') trigger = {type:'stage-click'};
      if (block.opcode === 'event_whenbroadcastreceived') trigger = {type:'broadcast', name:getField(block,'BROADCAST_OPTION')};
      if (!trigger) {
        if (block.opcode.startsWith('event_')) diagnostics.add(block.opcode);
        continue;
      }
      scripts.push({trigger, code:compileStack(blocks,block.next,diagnostics)});
    }
    return {
      name: target.name || (index === 0 ? 'Stage' : `Sprite ${index}`),
      isStage: !!target.isStage,
      x: Number(target.x) || 0,
      y: Number(target.y) || 0,
      direction: Number(target.direction) || 90,
      size: Number(target.size) || 100,
      visible: target.visible !== false,
      variables: Object.fromEntries(Object.values(target.variables || {}).map(variable => [variable[0], variable[1]])),
      costumes: (target.costumes || []).map(costume => ({
        name: costume.name,
        asset: costume.md5ext || (costume.assetId && (costume.assetId + '.' + costume.dataFormat)),
        rotationCenterX: costume.rotationCenterX || 0,
        rotationCenterY: costume.rotationCenterY || 0
      })),
      scripts
    };
  });
  return {
    version: 1,
    meta: {semantics: 'native-js-subset', projectName: project.projectName || 'Scratch project'},
    sprites,
    assets: project.nativeAssets || {},
    unsupportedOpcodes: [...diagnostics].sort()
  };
};

export const NATIVE_COMPILER_SUPPORTED = [
  'event_whenflagclicked','event_whenkeypressed','event_whenthisspriteclicked','event_whenstageclicked',
  'event_whenbroadcastreceived','event_broadcast','event_broadcastandwait',
  'motion_movesteps','motion_turnright','motion_turnleft','motion_gotoxy','motion_glidesecstoxy','motion_ifonedgebounce','motion_xposition','motion_yposition','motion_direction','motion_setx','motion_sety',
  'motion_changexby','motion_changeyby','motion_pointindirection',
  'looks_show','looks_hide','looks_setsizeto','looks_changesizeby','looks_nextcostume','looks_switchcostumeto','looks_say','looks_sayforsecs',
  'data_variable','data_setvariableto','data_changevariableby',
  'control_wait','control_repeat','control_forever','control_if','control_if_else','control_stop',
  'math_number','text','math_positive','math_negative','math_add','math_subtract','math_multiply','math_divide',
  'operator_equals','operator_gt','operator_lt','operator_and','operator_or','operator_not','operator_join',
  'operator_random','operator_mod','operator_round','operator_length','operator_contains','operator_letter_of','operator_mathop','sensing_mousex','sensing_mousey','sensing_mousedown','sensing_keypressed'
];
