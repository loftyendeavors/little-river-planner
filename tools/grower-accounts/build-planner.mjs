import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

// Take the planner's actual script order and screens from the release checkout.
export async function buildPlanner() {
  const out = 'dist/planner';
  await mkdir(out, { recursive: true });
  const page = await readFile('../../index.html', 'utf8');
  const scripts = [...page.matchAll(/<script src="(js\/[\w-]+\.js)"><\/script>/g)].map(match => match[1]);
  if (!scripts.includes('js/main.js') || !scripts.includes('js/store.js')) throw Error('Planner entry scripts changed.');
  const deviceOnly = new Set(['store', 'sync', 'snapshots', 'kept', 'folder', 'pwa'].map(name => 'js/' + name + '.js'));
  const parts = await Promise.all(scripts.filter(path => !deviceOnly.has(path)).map(async path => {
    const source = await readFile('../../' + path, 'utf8');
    return source.replaceAll('root.localStorage', 'root.LRFGrowerPreferences');
  }));
  const compiled = await transform(parts.join('\n;\n'), { minify: true, target: 'es2020' });
  await writeFile(out + '/planner.js', compiled.code);
  const noScripts = page.replace(/<script src="js\/[\w-]+\.js"><\/script>/g, '');
  await writeFile(out + '/index.html', noScripts.replace(/<link rel="manifest"[^>]+>/, '')
    .replace('</head>', '<meta name="referrer" content="no-referrer"></head>')
    .replace('</body>', '<script src="./frame.js"></script></body>'));
  await cp('src/planner-frame.js', out + '/frame.js');
  for (const dir of ['css', 'fonts', 'icons']) await cp('../../' + dir, out + '/' + dir, { recursive: true });
}
