// Dual RFC 8785 canonicalization. Node primary + Python independent
// oracle. Hard-fails (throws) if they diverge — no lock artifact may be
// produced when parity fails.
const canonicalizeNode = require('canonicalize');
const { execFileSync } = require('child_process');

function nodeCanonicalBytes(obj) {
  return Buffer.from(canonicalizeNode(obj), 'utf8');
}
function pythonCanonicalBytes(obj) {
  return execFileSync('python3', [__dirname + '/../canonicalize_py.py'], {
    input: JSON.stringify(obj),
    maxBuffer: 1024 * 1024 * 16,
  });
}
function nodeCanonicalizerVersion() { return require('canonicalize/package.json').version; }
function pythonCanonicalizerVersion() {
  return execFileSync('python3', ['-c', 'import rfc8785, importlib.metadata as m; print(m.version("rfc8785"))'], { encoding: 'utf8' }).trim();
}

// BUILD 02.1 item 8 — TEST-ONLY dependency injection seam.
// `oracles` is an optional third-positional-argument override of
// {nodeFn, pyFn}, used EXCLUSIVELY by test code that imports this module
// directly and calls dualCanonicalize(obj, null, oracles). There is no
// CLI flag, no environment variable, and no production call site anywhere
// in this repository that supplies this argument — every production path
// (prelock.js, lock-run.js, verify-lock-candidate equivalents) calls
// dualCanonicalize(obj) with a single argument. Grep the tree for
// "oracles" to confirm the only non-test call sites are this file and the
// two production modules, both of which omit the parameter.
function dualCanonicalize(obj, _unused, oracles) {
  const nodeFn = (oracles && oracles.nodeFn) || nodeCanonicalBytes;
  const pyFn = (oracles && oracles.pyFn) || pythonCanonicalBytes;
  const nodeBytes = nodeFn(obj);
  const pyBytes = pyFn(obj);
  if (!nodeBytes.equals(pyBytes)) {
    const err = new Error('CANONICALIZATION PARITY FAILURE: Node and Python produced different bytes');
    err.nodeBytes = nodeBytes; err.pythonBytes = pyBytes;
    throw err;
  }
  return { bytes: nodeBytes, nodeVersion: nodeCanonicalizerVersion(), pythonVersion: pythonCanonicalizerVersion() };
}

module.exports = { dualCanonicalize, nodeCanonicalBytes, pythonCanonicalBytes, nodeCanonicalizerVersion, pythonCanonicalizerVersion };
