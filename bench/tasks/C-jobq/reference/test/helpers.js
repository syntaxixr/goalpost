'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobq-test-')), 'q.json');
