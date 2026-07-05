import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow } from '../src/index.js';

test('selector fragment: x-with ancestor pushes bindings during control-path walk', async () => {
  const r = new Reflow();
  await r.compile('t',
    '<article x-with="post = { title: $.raw, body: $.text }">' +
    '<header id="head"><h1 x-text="@post.title"></h1></header>' +
    '<section><p x-text="@post.body"></p></section>' +
    '</article>'
  );
  const out = r.render('t', { raw: 'Hello', text: 'World' }, '#head');
  assert.equal(out, '<header id="head"><h1>Hello</h1></header>');
});

test('selector fragment: x-with on x-include element carries bindings into included template', async () => {
  const r = new Reflow();
  await r.compile('panel',
    '<section><h2 id="ph" x-text="@title"></h2><p x-text="@body"></p></section>'
  );
  await r.compile('layout',
    '<div><article x-include="\'panel\'" x-with="title = $.t, body = $.b"></article></div>'
  );
  const out = r.render('layout', { t: 'Fragment', b: 'inside include' }, '#ph');
  assert.equal(out, '<h2 id="ph">Fragment</h2>');
});

test('selector fragment: x-with combined with x-each on ancestor', async () => {
  const r = new Reflow({ helpers: { upper: (s) => String(s).toUpperCase() } });
  await r.compile('t',
    '<ul>' +
    '<li x-each="row in $.rows" x-with="upname = upper(.row.name)">' +
    '<span x-if=".row.name == \'bob\'" id="target" x-text="@upname"></span>' +
    '</li>' +
    '</ul>'
  );
  const out = r.render(
    't',
    { rows: [{ name: 'alice' }, { name: 'bob' }] },
    '#target'
  );
  assert.equal(out, '<span id="target">BOB</span>');
});
