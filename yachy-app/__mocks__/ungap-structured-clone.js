/** Use Node's built-in structuredClone in Jest (Node 17+) */
module.exports = { default: globalThis.structuredClone || (obj => JSON.parse(JSON.stringify(obj))) };
