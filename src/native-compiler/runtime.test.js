import {NativeRuntime} from './runtime';

const makeBlock=(opcode,next=null,inputs={},fields={},topLevel=false)=>({opcode,next,inputs,fields,topLevel,shadow:false});
const makeProject=blocks=>({targets:[{id:'stage',name:'Stage',isStage:true,blocks:{},variables:{},lists:{}},{id:'sprite',name:'Sprite1',isStage:false,blocks,variables:{score:['score',0]},lists:{items:['items',[]]}}]});

describe('native runtime v2',()=>{
  test('runs SB3 block graphs without importing Scratch VM',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','set',{}, {},true),
      set:makeBlock('data_setvariableto','move',{VALUE:[1,[4,'12']]},{VARIABLE:['score','score']}),
      move:makeBlock('motion_changexby',null,{DX:[1,[4,'8']]})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].variables.score.value).toBe(12);
    expect(runtime.sprites[0].x).toBe(8);
    runtime.stopAll();
  });

  test('supports lists and repeat/if control flow',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','repeat',{}, {},true),
      repeat:makeBlock('control_repeat',null,{TIMES:[1,[4,'3']],SUBSTACK:[2,'add']}),
      add:makeBlock('data_addtolist','change',{ITEM:[1,[10,'x']]},{LIST:['items','items']}),
      condition:makeBlock('control_if',null,{CONDITION:[2,'equals'],SUBSTACK:[2,'change']}),
      equals:makeBlock('operator_equals',null,{OPERAND1:[1,[10,'yes']],OPERAND2:[1,[10,'yes']]}),
      change:makeBlock('data_changevariableby',null,{VALUE:[1,[4,'1']]},{VARIABLE:['score','score']})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,150));
    expect(runtime.sprites[0].lists['items'].value).toHaveLength(3);
    expect(runtime.sprites[0].variables['score-id']?.value ?? runtime.sprites[0].variables.score.value).toBe(3);
    runtime.stopAll();
  });

  test('broadcast and wait launches matching receiver scripts',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','send',{}, {},true),
      send:makeBlock('event_broadcastandwait',null,{BROADCAST_INPUT:[1,[11,'ready','broadcast-id']]}),
      receiver:makeBlock('event_whenbroadcastreceived','update',{}, {BROADCAST_OPTION:['ready','broadcast-id']},true),
      update:makeBlock('data_changevariableby',null,{VALUE:[1,[4,'5']]},{VARIABLE:['score','score']})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(runtime.sprites[0].variables.score.value).toBe(5);
    runtime.stopAll();
  });

  test('supports native arithmetic reporters and resets project state on restart',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','set',{}, {},true),
      set:makeBlock('data_setvariableto','move',{VALUE:[2,'subtract']},{VARIABLE:['score','score']}),
      subtract:makeBlock('operator_subtract',null,{NUM1:[1,[4,'9']],NUM2:[1,[4,'4']]})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].variables.score.value).toBe(5);
    runtime.sprites[0].x=123;
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].x).toBe(0);
    expect(runtime.sprites[0].variables.score.value).toBe(5);
    runtime.stopAll();
  });

  test('draws Pen extension trails when sprites move with the pen down',async()=>{
    const lines=[];
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','down',{}, {},true),
      down:makeBlock('pen_penDown','move'),
      move:makeBlock('motion_changexby',null,{DX:[1,[4,'10']]})
    });
    const runtime=new NativeRuntime(project,{penLine:(_target,x1,y1,x2,y2)=>lines.push([x1,y1,x2,y2])});
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(lines).toContainEqual([0,0,10,0]);
    runtime.stopAll();
  });

  test('routes native sound blocks to the Web Audio host adapter',async()=>{
    const played=[];
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','play',{}, {},true),
      play:makeBlock('sound_playuntildone',null,{SOUND_MENU:[1,'menu']}),
      menu:makeBlock('sound_sounds_menu',null,{}, {SOUND_MENU:['meow','sound-id']})
    });
    const runtime=new NativeRuntime(project,{playSound:async(_target,name)=>played.push(name)});
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(played).toContain('meow');
    runtime.stopAll();
  });

  test('executes registered native extension adapters',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','custom',{}, {},true),
      custom:makeBlock('extension_native_set_score')
    });
    const runtime=new NativeRuntime(project);
    runtime.registerExtension('extension_native_set_score',{
      command:({runtime,target})=>runtime.setVariable(target,'score',42)
    });
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].variables.score.value).toBe(42);
    runtime.stopAll();
  });

  test('reports unsupported extension opcodes to host instead of silently pretending',async()=>{
    const unsupported=[];
    const project=makeProject({flag:makeBlock('event_whenflagclicked','custom',{}, {},true),custom:makeBlock('extension_example_custom')});
    const runtime=new NativeRuntime(project,{onUnsupported:opcode=>unsupported.push(opcode)});
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(unsupported).toContain('extension_example_custom');
    runtime.stopAll();
  });
});
