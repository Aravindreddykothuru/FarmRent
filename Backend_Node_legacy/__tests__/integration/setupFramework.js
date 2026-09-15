// Integration tests do real bcrypt work and network round-trips.
jest.setTimeout(30000);

// body-parser decodes request bodies with iconv-lite, which loads its encoding tables lazily. Under Jest's
// module registry that lazy require can resolve to undefined ("reading 'utf8'"), so load them up front.
const iconvPath = require.resolve('iconv-lite', { paths: [require.resolve('body-parser')] });
require(iconvPath).encodingExists('utf8');
