// Webpack loader for Next.js: stamps data-kerf locations on JSX before Next compiles it,
// the same way the Vite plugin does. Runs first ("pre") so lines and columns match the file.
const { pathToFileURL } = require('node:url');
const path = require('node:path');

let tagger;
module.exports = function kerfLoader(source) {
  const done = this.async();
  const { root } = this.getOptions();
  const file = this.resourcePath;
  if (process.env.KERF_DEBUG) console.log('kerf loader', file);
  if (!file.startsWith(root + path.sep) || /[\\/](node_modules|\.next)[\\/]/.test(file.slice(root.length))) return done(null, source);
  (tagger ||= import(pathToFileURL(path.join(__dirname, 'ast.mjs')).href))
    .then(({ tagSource }) => {
      const r = tagSource(source, file, root);
      done(null, r ? r.code : source);
    })
    .catch(() => done(null, source));
};
