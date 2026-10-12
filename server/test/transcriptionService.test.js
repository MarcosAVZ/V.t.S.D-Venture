import { describe, it, expect, vi } from 'vitest';
import { transcribeAudio } from '../src/services/transcriptionService.js';

describe('transcribeAudio', () => {
  it('falla con code TRANSCRIPTION_FAILED si el archivo no existe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(transcribeAudio('/no/existe.webm')).rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED' });
  });
});
