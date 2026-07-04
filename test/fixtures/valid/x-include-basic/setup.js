export default async (reflow) => {
  await reflow.compile('page', '<article><h1 x-text="$.title"></h1></article>');
};
