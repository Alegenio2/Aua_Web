#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, 'public/js');
const bundleDir = path.join(__dirname, 'public/js/bundles');
const cssDir = path.join(__dirname, 'public/css');

// Ensure bundle directory exists
if (!fs.existsSync(bundleDir)) {
  fs.mkdirSync(bundleDir, { recursive: true });
}

const bundles = [
  {
    name: 'index',
    files: ['main.js', 'proximoduelo_liga.js', 'torneosGlobales.js'],
    outfile: path.join(bundleDir, 'index.bundle.js'),
    description: 'Homepage bundle'
  },
  {
    name: 'torneo',
    files: ['torneorondas.js', 'rondas.js', 'torneoInternacional.js'],
    outfile: path.join(bundleDir, 'torneo.bundle.js'),
    description: 'Tournament page bundle'
  },
  {
    name: 'admin',
    files: ['admindraftcivs.js', 'admindraftmapas.js'],
    outfile: path.join(bundleDir, 'admin.bundle.js'),
    description: 'Admin bundle'
  }
];

function concatenateFiles(files, jsDir) {
  let content = '';
  for (const file of files) {
    const filePath = path.join(jsDir, file);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      content += `\n/* ===== ${file} ===== */\n${fileContent}`;
    }
  }
  return content;
}

async function minifyJS(code) {
  const { minify } = await import('terser');
  try {
    const result = await minify(code, {
      compress: { unsafe: false },
      mangle: false,
      output: { beautify: false }
    });
    return result.code || code;
  } catch (e) {
    console.warn('Terser error, returning unminified:', e.message);
    return code;
  }
}

async function buildBundles() {
  console.log('🔨 Iniciando build de bundles...\n');

  try {
    for (const bundle of bundles) {
      // Check if at least one file exists
      const existingFiles = bundle.files.filter(f => fs.existsSync(path.join(jsDir, f)));
      if (existingFiles.length === 0) {
        console.log(`⚠️  Skip ${bundle.name}: no files found`);
        continue;
      }

      console.log(`📦 Building ${bundle.name}: ${bundle.description}`);
      console.log(`   Files: ${existingFiles.join(', ')}`);

      // Concatenate files
      let combined = concatenateFiles(existingFiles, jsDir);

      // Minify
      let minified = await minifyJS(combined);

      // Write bundle
      fs.writeFileSync(bundle.outfile, minified, 'utf8');

      const stats = fs.statSync(bundle.outfile);
      const sizeKB = (stats.size / 1024).toFixed(2);
      const originalKB = (combined.length / 1024).toFixed(2);
      const savings = (((combined.length - minified.length) / combined.length) * 100).toFixed(1);

      console.log(`   ${originalKB} KB → ${sizeKB} KB (${savings}% savings)\n`);
    }

    console.log('✅ Bundles completados!\n');
  } catch (error) {
    console.error('❌ Error durante el build:', error);
    process.exit(1);
  }
}

async function minifyCSS() {
  console.log('🎨 Minificando CSS...\n');

  const cssFiles = ['style.css', 'admin.css'];

  try {
    for (const file of cssFiles) {
      const input = path.join(cssDir, file);
      const output = path.join(cssDir, file); // Overwrite original

      if (!fs.existsSync(input)) {
        console.log(`⚠️  ${file} not found`);
        continue;
      }

      const css = fs.readFileSync(input, 'utf8');
      // Simple minification: remove comments, extra whitespace
      let minified = css
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
        .replace(/\s+/g, ' ') // Collapse whitespace
        .replace(/\s*([{}:;,])\s*/g, '$1') // Remove space around special chars
        .trim();

      fs.writeFileSync(output, minified, 'utf8');

      const originalSize = css.length;
      const minSize = minified.length;
      const savings = (((originalSize - minSize) / originalSize) * 100).toFixed(1);

      console.log(`   ${file}`);
      console.log(`   ${(originalSize / 1024).toFixed(2)} KB → ${(minSize / 1024).toFixed(2)} KB (${savings}% savings)\n`);
    }

    console.log('✅ CSS minificado!\n');
  } catch (error) {
    console.error('❌ Error minificando CSS:', error);
    process.exit(1);
  }
}

async function main() {
  console.log('\n========== AUA BUILD PROCESS ==========\n');

  await buildBundles();
  await minifyCSS();

  console.log('========== BUILD COMPLETADO ==========\n');
  console.log('📋 Próximos pasos:');
  console.log('   1. Actualizar templates EJS para usar bundles');
  console.log('   2. Reemplazar Font Awesome CDN con SVG sprite');
  console.log('   3. Ejecutar tests y Lighthouse\n');
}

main();
