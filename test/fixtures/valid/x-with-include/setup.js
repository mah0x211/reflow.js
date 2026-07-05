export default async (reflow) => {
  await reflow.compile('panel',
    '<section><h2 x-text="@title"></h2><p x-text="@body"></p></section>');
};
