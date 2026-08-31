import assert from 'node:assert/strict';
import test from 'node:test';

test('prism-test is a development-only enabled Cover Flow destination',async()=>{
  const before=process.env.ARCADE_DEV;
  process.env.ARCADE_DEV='1';
  const dev=await import(`./menu.ts?dev=${Date.now()}`);
  assert.deepEqual(dev.MENU_ITEMS.find((item:{id:string})=>item.id==='prism-test'),{id:'prism-test',title:'Prism-Test',enabled:true,dev:true});
  if(before===undefined)delete process.env.ARCADE_DEV;else process.env.ARCADE_DEV=before;
});
