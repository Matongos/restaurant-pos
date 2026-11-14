// The stored (scrambled) form of a PIN, as web/src/domain/pinhash.ts makes it — for checking test results.
const { createHash } = require('crypto');
module.exports = function pinKey(pin) {
  let d = createHash('sha256').update('techplug-pos/pin/v1:' + pin).digest();
  for (let i = 1; i < 3000; i++) d = createHash('sha256').update(d).digest();
  return 'h1:' + d.toString('hex');
};
