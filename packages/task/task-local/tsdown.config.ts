/** Emit each published Host entry without unlisted shared chunks. */
import { defineConfig } from 'tsdown'
export default defineConfig(['index', 'maintenance'].map(name => ({
  entry: [`lib/types/${name}.js`], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
  fixedExtension: false, dts: false, clean: false,
})))
