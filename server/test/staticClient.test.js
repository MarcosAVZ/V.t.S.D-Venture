import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../src/services/sheetsService.js', () => ({
  executeOperation: vi.fn(), queryStock: vi.fn(), getProducts: vi.fn(), findProductByName: vi.fn(),
}));

import { createApp, resolveStaticDir } from '../src/index.js';

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtsd-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>SPA-INDEX</body></html>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => { delete process.env.STATIC_DIR; vi.restoreAllMocks(); });

const make = (opts = {}) => createApp({ host: '127.0.0.1', port: 3000, isProduction: true, ...opts });

describe('cliente estatico en modo produccion local', () => {
  it('sirve index.html desde el directorio configurado (opcion staticDir)', async () => {
    const res = await request(make({ staticDir: dir })).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA-INDEX');
  });

  it('fallback SPA: una ruta del cliente devuelve index.html', async () => {
    const res = await request(make({ staticDir: dir })).get('/alguna/ruta/del/cliente');
    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA-INDEX');
  });

  it('sirve archivos estaticos reales', async () => {
    const res = await request(make({ staticDir: dir })).get('/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log(1)');
  });

  it('la API sigue funcionando y una ruta /api desconocida NO cae en el SPA', async () => {
    const app = make({ staticDir: dir });
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('SPA-INDEX');
  });

  it('usa STATIC_DIR del entorno cuando no se pasa la opcion', async () => {
    process.env.STATIC_DIR = dir;
    const res = await request(make()).get('/x');
    expect(res.text).toContain('SPA-INDEX');
  });

  it('si el directorio no existe: avisa y no sirve el cliente (la API sigue)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = make({ staticDir: path.join(dir, 'no-existe') });
    expect((await request(app).get('/')).status).toBe(404);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('en desarrollo (isProduction=false) no sirve estaticos', async () => {
    const res = await request(make({ isProduction: false, staticDir: dir })).get('/');
    expect(res.status).toBe(404);
  });

  it('por defecto resuelve client/dist (la salida de Vite), no server/public', () => {
    const resolved = resolveStaticDir();
    expect(resolved.replaceAll('\\', '/')).toMatch(/client\/dist$/);
  });

  it('resolveStaticDir respeta STATIC_DIR', () => {
    process.env.STATIC_DIR = dir;
    expect(resolveStaticDir()).toBe(path.resolve(dir));
  });
});

describe('scripts de arranque', () => {
  it('server/package.json "start" corre en modo produccion (serve-prod.js), igual que el start de la raiz', () => {
    const serverPkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(serverPkg.scripts.start).toBe('node src/serve-prod.js');
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/serve-prod.js'))).toBe(true);
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', 'package.json'), 'utf-8'));
    expect(rootPkg.scripts.start).toMatch(/serve-prod\.js/);
  });
});
