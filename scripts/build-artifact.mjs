// Inlines the single-file build into one HTML page for publishing as an artifact.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = 'dist-artifact/assets';
const files = readdirSync(dir);
const js = readFileSync(`${dir}/${files.find((f) => f.endsWith('.js'))}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(`${dir}/${files.find((f) => f.endsWith('.css'))}`, 'utf8');
const html = `<title>Brand Command Center</title>
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync('dist-artifact/brand-command-center.html', html);
console.log(`wrote dist-artifact/brand-command-center.html (${(html.length / 1024).toFixed(0)} KB)`);
