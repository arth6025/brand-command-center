// Inlines the single-file build into one HTML page for publishing as an artifact.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = 'dist-artifact/assets';
const files = readdirSync(dir);
const js = readFileSync(`${dir}/${files.find((f) => f.endsWith('.js'))}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(`${dir}/${files.find((f) => f.endsWith('.css'))}`, 'utf8');
const html = `<title>Brand Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..700&family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync('dist-artifact/brand-command-center.html', html);
console.log(`wrote dist-artifact/brand-command-center.html (${(html.length / 1024).toFixed(0)} KB)`);
