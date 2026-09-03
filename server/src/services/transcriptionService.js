import OpenAI from 'openai';
import fs from 'fs';

let openai = null;

function getClient() {
  if (!openai) {
    openai = new OpenAI();
  }
  return openai;
}

/**
 * Transcribes audio file using OpenAI Whisper.
 * @param {string} filePath - Path to audio file
 * @returns {Promise<string>} Transcribed text
 * @throws {Error} If transcription fails
 */
export async function transcribeAudio(filePath) {
  try {
    const audioFile = fs.createReadStream(filePath);
    const response = await getClient().audio.transcriptions.create({
      model: 'whisper-1',
      file: audioFile,
    });
    return response.text;
  } catch (error) {
    console.error('Whisper API error:', error.message);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}