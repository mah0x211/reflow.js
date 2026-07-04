import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowCompileError, ReflowRuntimeError, ReflowIncludeError } from '../../src/index.js';

test('x-for missing "=" fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="i 1, 3" x-text=".i"></li>'),
    /x-for.*=/
  );
});

test('x-for invalid variable name fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="1x = 1, 3" x-text=".i"></li>'),
    /invalid variable name/
  );
});

test('x-for wrong arg count fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="i = 1" x-text=".i"></li>'),
    /expected 2 or 3 arguments/
  );
});

test('x-each missing in keyword fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-each="user $.users" x-text=".user"></li>'),
    /expected .*in/
  );
});

test('x-each with item==index fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-each="x, x in $.users" x-text=".x"></li>'),
    /must differ/
  );
});

test('x-each invalid collection expression fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-each="u in .a.b()"></li>'),
    /x-each/
  );
});

test('x-elseif with empty value fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div><template x-if=".a">A</template><template x-elseif="">B</template></div>'),
    /x-elseif: value is required/
  );
});

test('elseif after else fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div><template x-if=".a">A</template><template x-else>E</template><template x-elseif=".b">B</template></div>'),
    /x-elseif after x-else/
  );
});

test('multiple x-else in chain fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div><template x-if=".a">A</template><template x-else>E1</template><template x-else>E2</template></div>'),
    /multiple x-else|x-else has no preceding|x-elseif after x-else/
  );
});

test('x-match with mixed children (non-case element) fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div x-match="$.v"><p>plain</p><p x-case="\'a\'">A</p></div>'),
    /x-match.*must be x-case or x-nocase/
  );
});

test('multiple x-nocase in same match fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div x-match="$.v"><p x-case="\'a\'">A</p><p x-nocase>D1</p></div><div x-match="$.v"><p x-case="\'b\'">B</p><p x-nocase>D1</p><p x-nocase>D2</p></div>'),
    /(multiple x-nocase|x-case must not appear after x-nocase)/
  );
});

test('S+K same element fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<ul><li x-for="i = 1, 3"><span x-if=".a" x-break>x</span></li></ul>'),
    /structural.*control|control.*structural/
  );
});

test('duplicate x-data on same element is rejected', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div x-data="a: {x: 1}" x-data="b: {y: 2}"><p x-text=".a.x"></p></div>'),
    /duplicate x-data/
  );
});

test('include not-found produces requested', async () => {
  const r = new Reflow();
  await r.compile('t', '<section x-include="\'no-such\'"></section>');
  try {
    r.render('t');
    assert.fail();
  } catch (err) {
    assert.equal(err.reason, 'not_found');
    assert.equal(err.requested, 'no-such');
  }
});

test('include depth exceeded (via mutual, non-cycle)', async () => {
  const r = new Reflow({ maxIncludeDepth: 2 });
  await r.compile('a', '<section x-include="\'b\'"></section>');
  await r.compile('b', '<section x-include="\'c\'"></section>');
  await r.compile('c', '<section x-include="\'d\'"></section>');
  await r.compile('d', '<p>leaf</p>');
  try {
    r.render('a');
    assert.fail();
  } catch (err) {
    assert.ok(err instanceof ReflowIncludeError);
    assert.equal(err.reason, 'depth_exceeded');
  }
});

test('runtime error inside x-for iteration wraps non-BreakSignal', async () => {
  const helpers = { boom: () => { throw new Error('boom'); } };
  const r = new Reflow({ helpers });
  await r.compile('t', '<ul><li x-for="i = 1, 3"><span x-text="boom()"></span></li></ul>');
  assert.throws(() => r.render('t'), /boom/);
});

test('runtime error inside x-each iteration wraps non-BreakSignal', async () => {
  const helpers = { boom: () => { throw new Error('boom-each'); } };
  const r = new Reflow({ helpers });
  await r.compile('t', '<ul><li x-each="u in $.users"><span x-text="boom()"></span></li></ul>');
  assert.throws(() => r.render('t', { users: [1, 2] }), /boom-each/);
});

test('x-bind with array value fails', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-bind:class="$.arr"></div>');
  assert.throws(
    () => r.render('t', { arr: ['a', 'b'] }),
    /must be primitive/
  );
});
