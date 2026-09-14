import { PwaService } from './pwa/PwaService';

const canvas = document.getElementById('game-canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('game canvas is missing');
}

export const gameCanvas = canvas;

PwaService.register();
