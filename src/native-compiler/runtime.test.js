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
      repeat:makeBlock('control_repeat','condition',{TIMES:[1,[4,'3']],SUBSTACK:[2,'add']}),
      add:makeBlock('data_addtolist','condition2',{ITEM:[1,[10,'x']]},{LIST:['items','items']}),
      condition:makeBlock('control_if',null,{CONDITION:[2,'equals'],SUBSTACK:[2,'change']}),
      equals:makeBlock('operator_equals',null,{OPERAND1:[1,[10,'yes']],OPERAND2:[1,[10,'yes']]}),
      change:makeBlock('data_changevariableby',null,{VALUE:[1,[4,'1']]},{VARIABLE:['score','score']})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,10));
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
