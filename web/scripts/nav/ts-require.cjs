// Chargeur minimal : permet à node (sans dépendance supplémentaire) de
// require() les modules TypeScript de src/, en les transpilant à la volée avec
// le compilateur TypeScript déjà présent dans les devDependencies du projet.
// Gère l'alias « @/… » → src/… et les imports JSON.
const fs = require('fs')
const path = require('path')
const Module = require('module')

const WEB = path.resolve(__dirname, '..', '..')
const ts = require(path.join(WEB, 'node_modules', 'typescript'))

const originalResolve = Module._resolveFilename
Module._resolveFilename = function resolve(request, parent, ...rest) {
  if (request.startsWith('@/')) request = path.join(WEB, 'src', request.slice(2))
  return originalResolve.call(this, request, parent, ...rest)
}

require.extensions['.ts'] = function compile(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

module.exports = { WEB }
