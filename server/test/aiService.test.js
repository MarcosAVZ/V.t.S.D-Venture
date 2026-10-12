import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('groq-sdk', () => ({
  default: class Groq {
    chat = { completions: { create: mockCreate } };
  },
}));

import { extractOperationData } from '../src/services/aiService.js';

const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

beforeEach(() => {
  mockCreate.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('extractOperationData errors', () => {
  it('preserva code y operations de MULTIPLE_OPERATIONS', async () => {
    mockCreate.mockResolvedValue(reply({ error: 'multiple_operations', operations: ['COMPRA', 'VENTA'] }));
    await expect(extractOperationData('x')).rejects.toMatchObject({
      code: 'MULTIPLE_OPERATIONS',
      operations: ['COMPRA', 'VENTA'],
    });
  });

  it('otros errores llevan code AI_EXTRACTION_FAILED y cause', async () => {
    const boom = new Error('network down');
    mockCreate.mockRejectedValue(boom);
    const err = await extractOperationData('x').catch((e) => e);
    expect(err.code).toBe('AI_EXTRACTION_FAILED');
    expect(err.cause).toBe(boom);
  });

  it('JSON invalido => AI_EXTRACTION_FAILED', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'no json' } }] });
    await expect(extractOperationData('x')).rejects.toMatchObject({ code: 'AI_EXTRACTION_FAILED' });
  });

  it('camino feliz normaliza a minusculas', async () => {
    mockCreate.mockResolvedValue(reply({ operation: 'CONSULTA', producto: '  REMERA ', color: null, talle: null }));
    const r = await extractOperationData('x');
    expect(r.producto).toBe('remera');
  });
});
