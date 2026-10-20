const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Source files are browser ES modules while package.json is CommonJS. Load the
// original sources without rewriting them or changing the application package.
async function loadEsm(relativePath) {
    const root = path.resolve(__dirname, '../..');
    const modules = new Map();
    const load = filename => {
        if (!modules.has(filename)) {
            modules.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
                identifier: filename,
            }));
        }
        return modules.get(filename);
    };
    const entry = load(path.resolve(root, relativePath));
    await entry.link((specifier, referencing) =>
        load(path.resolve(path.dirname(referencing.identifier), specifier)));
    await entry.evaluate();
    return entry.namespace;
}

module.exports = { loadEsm };
