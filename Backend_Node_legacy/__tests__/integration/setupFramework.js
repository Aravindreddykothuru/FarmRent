// Integration tests do real bcrypt work and network round-trips.
jest.setTimeout(30000);

// body-parser decodes request bodies with iconv-lite, which loads its encoding tables lazily. Under Jest's
// module registry that lazy require can resolve to undefined ("reading 'utf8'"), so load them up front.
const iconvPath = require.resolve('iconv-lite', { paths: [require.resolve('body-parser')] });
require(iconvPath).encodingExists('utf8');

// Build the app while the test file is being set up, not inside a suite's beforeAll: the first load reads thousands
// of dependency files, and right after a fresh install (CI, a new clone) that alone can exceed the hook timeout.
require('./helpers').getApp();
