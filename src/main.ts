import { PwaService } from './pwa/PwaService';
import { AudioEngine } from './audio/AudioEngine';
import { createGame } from './game/Game';
import { SaveService } from './progression/SaveService';
import { Renderer } from './rendering/Renderer';
import { UiController } from './ui/UiController';

const canvas = document.getElementById('game-canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('game canvas is missing');
}

export const gameCanvas = canvas;

PwaService.register();

const save = new SaveService(globalThis.localStorage, (context, error) => {
  console.warn(`[neon-rush] save ${context} failed`, error);
});
const settings = save.load().settings;
const renderer = new Renderer(canvas, settings.quality);
const ui = new UiController();
const audio = new AudioEngine();

export const game = createGame({ canvas, renderer, ui, audio, save });
