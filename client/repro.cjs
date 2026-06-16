const { transform } = require('sucrase');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// stub axios
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') {
    return { default: { create: () => ({ interceptors: { request: { use(){} } }, get(){},post(){},patch(){},delete(){} }) } };
  }
  return origLoad.apply(this, arguments);
};

// loader for .js as ESM->CJS via sucrase
require.extensions['.js'] = function (module, filename) {
  let src = fs.readFileSync(filename, 'utf8');
  const out = transform(src, { transforms: ['imports','jsx'], filePath: filename }).code;
  module._compile(out, filename);
};
// no localStorage
global.localStorage = undefined;

const api = require(path.resolve('src/api.js'));
const a = api.default || api;

(async () => {
  // simulate NewProjectDialog payload
  const payload = { title:'Test', type:'TR', assignees:['u-elif'], subtasks:['kapak','kutu'], pageCount: undefined, target_month: '2026-07-01' };
  const created = await a.createProject(payload);
  console.log('CREATED:', JSON.stringify(created, null, 2));
  const detail = await a.getProject(created.id);
  console.log('DETAIL keys:', Object.keys(detail));
  console.log('subtasks:', JSON.stringify(detail.subtasks));
  console.log('assignees:', JSON.stringify(detail.assignees));
  console.log('history len:', (detail.history||[]).length);
})().catch(e => { console.error('THREW:', e); process.exit(1); });
