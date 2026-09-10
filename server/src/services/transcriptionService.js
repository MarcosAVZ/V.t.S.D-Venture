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
    // Check file exists and has content
    const stats = fs.statSync(filePath);
    console.log(`[whisper] File: ${filePath}, size: ${stats.size} bytes`);

    if (stats.size < 100) {
      throw new Error('Audio file too small — recording may have failed');
    }

    const transcription = await getClient().audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3-turbo',
    });
    console.log(`[whisper] Success: "${transcription.text.substring(0, 80)}..."`);
    return transcription.text;
  } catch (error) {
    console.error('[whisper] Error:', error.status, error.message);
    if (error.error) {
      console.error('[whisper] Details:', JSON.stringify(error.error));
    }
    throw new Error(`Transcription failed: ${error.status} ${error.message}`);
  }
}
