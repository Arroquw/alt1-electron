const { execSync } = require('child_process');
execSync(`npm run dist:${process.platform}`, { stdio: 'inherit' });