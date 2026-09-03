import Groq from 'groq-sdk';
import fs from 'fs';

let groq = null;

function getClient() {
  if (!groq) {
    groq = new Groq();
  }
  return groq;
}

/**
 * Transcribes audio file using Groq Whisper.
 * @param {string} filePath - Path to audio file
 * @returns {Promise<string>} Transcribed text
 * @throws {Error} If transcription fails
 */
export async function transcribeAudio(filePath) {
  try {
    const transcription = await getClient().audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3-turbo',
    });
    return transcription.text;
  } catch (error) {
    console.error('Groq Whisper error:', error.message);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}
