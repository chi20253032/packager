import {compileNativeProject} from './compiler';
import {createNativeHTML} from './native-html';

const block = (opcode, next = null, inputs = {}, fields = {}, topLevel = false) => ({
  opcode, next, inputs, fields, topLevel, shadow: false
});

describe('native Scratch compiler', () => {
  test('compiles flag scripts and core motion commands', () => {
    const project = {
      targets: [{
        name: 'Sprite1',
        isStage: false,
        blocks: {
          flag: block('event_whenflagclicked', 'move', {}, {}, true),
          move: block('motion_movesteps', 'hide', {STEPS: [1, [4, '10']]}),
          hide: block('looks_hide')
        }
      }]
    };
    const result = compileNativeProject(project);
    expect(result.sprites[0].scripts).toHaveLength(1);
    expect(result.sprites[0].scripts[0].trigger.type).toBe('flag');
    expect(result.sprites[0].scripts[0].code).toContain('api.move(10,0)');
    expect(result.sprites[0].scripts[0].code).toContain('api.sprite.visible=false');
    expect(result.unsupportedOpcodes).toEqual([]);
  });

  test('reports unsupported opcodes instead of silently dropping them', () => {
    const project = {
      targets: [{
        name: 'Sprite1',
        blocks: {
          flag: block('event_whenflagclicked', 'extension', {}, {}, true),
          extension: block('motion_setrotationstyle')
        }
      }]
    };
    const result = compileNativeProject(project);
    expect(result.unsupportedOpcodes).toContain('motion_setrotationstyle');
  });

  test('emits syntactically valid async JavaScript for nested control flow', () => {
    const project = {
      targets: [{
        name: 'Sprite1',
        blocks: {
          flag: block('event_whenflagclicked', 'repeat', {}, {}, true),
          repeat: block('control_repeat', null, {
            TIMES: [1, [4, '3']],
            SUBSTACK: [2, 'move']
          }),
          move: block('motion_movesteps', null, {STEPS: [1, [4, '10']]})
        }
      }]
    };
    const result = compileNativeProject(project);
    expect(result.sprites[0].scripts[0].code).toContain('api.move(10,0)');
    expect(() => new Function('api', 'input', 'return (async()=>{' + result.sprites[0].scripts[0].code + '})()')).not.toThrow();
  });


  test('compiles broadcasts and variable reporters', () => {
    const project = {
      targets: [{
        name: 'Sprite1',
        variables: {score: ['score', 0]},
        blocks: {
          flag: block('event_whenflagclicked', 'set', {}, {}, true),
          set: block('data_setvariableto', 'broadcast', {
            VALUE: [1, [4, '5']]
          }, {VARIABLE: ['score', 'score-id']}),
          broadcast: block('event_broadcast', null, {
            BROADCAST_INPUT: [1, [11, 'done', 'broadcast-id']]
          })
        }
      }]
    };
    const result = compileNativeProject(project);
    expect(result.sprites[0].scripts[0].code).toContain('api.setVar("score",5)');
    expect(result.sprites[0].scripts[0].code).toContain('api.broadcast("done")');
  });


  test('creates a standalone HTML document without the Scratch Player bundle', () => {
    const html = createNativeHTML({targets: [{name: 'Sprite1', blocks: {}}]}, 'Native Test');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Native Test');
    expect(html).not.toContain('Scaffolding');
    expect(html).not.toContain('scratch-vm');
  });

  test('rejects malformed project data', () => {
    expect(() => compileNativeProject({})).toThrow('targets are missing');
  });
});
