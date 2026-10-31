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

  test('passes custom procedure arguments into native argument reporters',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','call',{}, {},true),
      call:makeBlock('procedures_call',null,{input0:[1,[4,'37']]}),
      definition:makeBlock('procedures_definition','set',{custom_block:[1,'prototype']},{},true),
      prototype:makeBlock('procedures_prototype',null,{},{}),
      set:makeBlock('data_setvariableto',null,{VALUE:[2,'argument']},{VARIABLE:['score','score']}),
      argument:makeBlock('argument_reporter_string_number',null,{}, {VALUE:['amount',null]})
    });
    project.targets[1].blocks.prototype.mutation={proccode:'add %s',argumentids:'["arg-id"]',argumentnames:'["amount"]',warp:'false'};
    project.targets[1].blocks.call.mutation={proccode:'add %s',argumentids:'["arg-id"]',argumentnames:'["amount"]',warp:'false'};
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(runtime.sprites[0].variables.score.value).toBe(37);
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

  test('compares non-numeric operands using Scratch-style case-insensitive text ordering',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','set',{}, {},true),
      set:makeBlock('data_setvariableto',null,{VALUE:[2,'greater']},{VARIABLE:['score','score']}),
      greater:makeBlock('operator_gt',null,{OPERAND1:[1,[10,'banana']],OPERAND2:[1,[10,'Apple']]})
    });
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].variables.score.value).toBe(true);
    runtime.stopAll();
  });

  test('uses sprite bounds for native touching sensing',async()=>{
    const project=makeProject({});
    const runtime=new NativeRuntime(project);
    const a=runtime.sprites[0];
    const b={...a,id:'other',x:40,y:0,alive:true,visible:true,costumes:[],currentCostume:0,size:100,rotationStyle:'all around'};
    runtime.targets.push(b);
    expect(runtime.overlaps(a,b)).toBe(true);
    b.x=100;
    expect(runtime.overlaps(a,b)).toBe(false);
  });

  test('deleting a clone releases its clone slot and stop-all removes remaining clones',async()=>{
    const runtime=new NativeRuntime(makeProject({}));
    const original=runtime.sprites[0];
    const clone=runtime.createClone(original);
    expect(runtime.clones).toHaveLength(1);
    await runtime.executeBlock(clone,makeBlock('control_delete_this_clone'),{cancelled:false,target:clone});
    expect(runtime.clones).toHaveLength(0);
    expect(runtime.targets).not.toContain(clone);
    runtime.stopAll();
    expect(runtime.targets).toEqual(runtime.originalTargets);
  });

  test('deletes all list entries through the native list index menu',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','remove',{}, {},true),
      remove:makeBlock('data_deleteoflist',null,{INDEX:[1,[10,'all']]},{LIST:['items','items']})
    });
    project.targets[1].lists.items[1]=['one','two','three'];
    const runtime=new NativeRuntime(project);
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].lists.items.value).toEqual([]);
    runtime.stopAll();
  });

  test('tracks show and hide state for variable and list monitors',()=>{
    const runtime=new NativeRuntime(makeProject({}));
    runtime.setMonitorVisible('score',true);
    runtime.setMonitorVisible('items',true);
    expect(runtime.monitors.get('score').visible).toBe(true);
    expect(runtime.monitors.get('items').visible).toBe(true);
    runtime.setMonitorVisible('score',false);
    expect(runtime.monitors.get('score').visible).toBe(false);
  });

  test('implements native Music extension tempo and note dispatch',async()=>{
    const notes=[];
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','tempo',{}, {},true),
      tempo:makeBlock('music_setTempo','instrument',{TEMPO:[1,[4,'120']]}),
      instrument:makeBlock('music_setInstrument','note',{INSTRUMENT:[1,[4,'3']]}),
      note:makeBlock('music_playNoteForBeats',null,{NOTE:[1,[4,'69']],BEATS:[1,[4,'0.5']]})
    });
    const runtime=new NativeRuntime(project,{playMusicNote:async(...args)=>notes.push(args.slice(0,4))});
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(runtime.tempo).toBe(120);
    expect(runtime.instrument).toBe(3);
    expect(notes[0]).toEqual([69,0.5,3,120]);
    runtime.stopAll();
  });

  test('sends native cloud variable changes through the host bridge',()=>{
    const project=makeProject({});
    project.targets[1].variables.score[2]=true;
    const updates=[];
    const runtime=new NativeRuntime(project,{onCloudVariable:(name,value)=>updates.push([name,value])});
    runtime.setVariable(runtime.sprites[0],'score',12);
    expect(updates).toEqual([['score',12]]);
    runtime.applyCloudVariable('score','21');
    expect(runtime.sprites[0].variables.score.value).toBe('21');
    expect(updates).toHaveLength(1);
  });

  test('executes registered native extension reporters',async()=>{
    const project=makeProject({
      flag:makeBlock('event_whenflagclicked','set',{}, {},true),
      set:makeBlock('data_setvariableto',null,{VALUE:[2,'reporter']},{VARIABLE:['score','score']}),
      reporter:makeBlock('extension_native_score')
    });
    const runtime=new NativeRuntime(project);
    runtime.registerExtension('extension_native_score',{reporter:()=>99});
    runtime.start();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(runtime.sprites[0].variables.score.value).toBe(99);
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
