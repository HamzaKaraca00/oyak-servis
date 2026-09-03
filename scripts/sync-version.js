const fs = require('fs');
const path = require('path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const appVersion = packageJson.appVersion;
if (!appVersion) {
  throw new Error('package.json must define appVersion.');
}

const publicPath = path.join(__dirname, '..', 'public');
const indexPath = path.join(publicPath, 'index.html');
const serviceWorkerPath = path.join(publicPath, 'sw.js');

function updateFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  replacements.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, replacement);
  });
  fs.writeFileSync(filePath, content);
}

updateFile(indexPath, [
  [/\/styles\.css\?v=[^"]+/, `/styles.css?v=styles-${appVersion}`],
  [/\/app\.js\?v=[^"]+/, `/app.js?v=app-${appVersion}`]
]);

updateFile(serviceWorkerPath, [
  [/payogum-shell-[^']+/, `payogum-shell-${appVersion}`],
  [/\/styles\.css\?v=[^']+/, `/styles.css?v=styles-${appVersion}`],
  [/\/app\.js\?v=[^']+/, `/app.js?v=app-${appVersion}`]
]);
